import type { Contribution, Membership, MembershipSlot, TontineSession, User } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { generateReceiptPdf } from "@/lib/receipt";
import { saveFile } from "@/lib/storage";
import { sendWhatsAppMessageSafe } from "@/lib/whatsapp/evolution";
import { sendEmailSafe } from "@/lib/email/resend";
import { paymentSuccessMessage } from "@/lib/whatsapp/templates";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import { formatXAF } from "@/lib/format-currency";
import { translate, type Lang } from "@/lib/i18n/translations";
import { TONTINE_TYPE_LABELS } from "@/lib/tontine-labels";

type ContributionWithSlot = Contribution & {
  membershipSlot: MembershipSlot & {
    membership: Membership & { user: User; tontineSession: TontineSession };
  };
  paidByUser: User | null;
};

/**
 * Marks a Contribution PAID, settles this same slot's own unpaid Fine for
 * the same cycle, generates+stores the receipt, and notifies the owning
 * member — the exact sequence that used to live only in the Fapshi webhook.
 * Shared with the admin manual-contribution route so a manually-recorded
 * payment looks identical to a Fapshi-confirmed one on the member's side.
 */
export async function settleContribution(
  contribution: ContributionWithSlot,
  options: { paidAt: Date; origin: string },
): Promise<void> {
  const { membership } = contribution.membershipSlot;
  const { user, tontineSession } = membership;

  const paidByName = contribution.paidByUser?.name;

  const paymentFee = Number(contribution.providerFeeAmount ?? 0);

  const receiptBytes = await generateReceiptPdf({
    memberName: `${user.name} — ${contribution.membershipSlot.beneficiaryName}`,
    paidByName,
    paymentMethod: contribution.recordedByAdminId ? "Recorded by admin" : "Mobile Money / Orange Money (Fapshi)",
    tontineType: tontineSession.type,
    amount: Number(contribution.amountPaid),
    fee: Number(contribution.feePaid),
    fine: Number(contribution.finePaid),
    paymentFee: paymentFee > 0 ? paymentFee : undefined,
    total: Number(contribution.amountPaid) + Number(contribution.feePaid) + Number(contribution.finePaid) + paymentFee,
    transRef: contribution.fapshiTxRef ?? contribution.id,
    paidAt: options.paidAt,
  });
  const receiptKey = `receipts/${user.id}/${contribution.id}.pdf`;
  await saveFile(receiptKey, receiptBytes);

  await prisma.$transaction([
    prisma.contribution.update({
      where: { id: contribution.id },
      data: { status: "PAID", paidAt: options.paidAt, receiptPdfUrl: receiptKey },
    }),
    ...(Number(contribution.finePaid) > 0
      ? [
          prisma.fine.updateMany({
            where: {
              membershipSlotId: contribution.membershipSlotId,
              dueDate: contribution.dueDate,
              status: "UNPAID",
            },
            data: { status: "PAID" },
          }),
        ]
      : []),
  ]);

  const totalPaid =
    Number(contribution.amountPaid) + Number(contribution.feePaid) + Number(contribution.finePaid) + paymentFee;
  const sessionLabel = tontineSession.title || TONTINE_TYPE_LABELS[tontineSession.type];
  const receiptUrl = `${options.origin}/api/files/${receiptKey}`;
  const recipientLang: Lang = user.preferredLang === "en" ? "en" : "fr";

  await sendWhatsAppMessageSafe(
    user.phone,
    paymentSuccessMessage(
      recipientLang,
      `${user.name} (${contribution.membershipSlot.beneficiaryName})`,
      totalPaid,
      sessionLabel,
      receiptUrl,
    ),
  );

  await sendEmailSafe(
    user.email,
    translate(recipientLang, "paymentReceivedEmailSubject", { session: sessionLabel }),
    paymentSuccessEmailHtml(recipientLang, {
      recipientName: user.name,
      beneficiaryName: contribution.membershipSlot.beneficiaryName,
      paidByName,
      sessionLabel,
      amount: totalPaid,
      transRef: contribution.fapshiTxRef ?? contribution.id,
      receiptUrl,
    }),
  );

  await scheduleInAppNotifications({
    tontineSessionId: membership.tontineSessionId,
    type: "PAYMENT_SUCCESS",
    recipients: [
      {
        userId: user.id,
        message: `Your payment of ${formatXAF(totalPaid)} for ${sessionLabel} was received. Thank you!`,
        messageKey: "paymentSuccessNotifMessage",
        messageVars: { amount: formatXAF(totalPaid), session: sessionLabel },
        actionUrl: `/sessions/${membership.tontineSessionId}`,
      },
    ],
  });

  // Group celebration notification: Notify other approved members in the cotisation
  // that a member has contributed (e.g. "Awa • Tontine du Quartier : « J'ai cotisé, merci la team ! »")
  const otherMemberships = prisma.membership?.findMany
    ? await prisma.membership.findMany({
        where: {
          tontineSessionId: membership.tontineSessionId,
          status: "APPROVED",
          userId: { not: user.id },
        },
        select: { userId: true },
      })
    : [];

  if (otherMemberships.length > 0) {
    const payerDisplayName =
      paidByName || contribution.membershipSlot.beneficiaryName || user.name || "Un membre";
    await scheduleInAppNotifications({
      tontineSessionId: membership.tontineSessionId,
      type: "PAYMENT_SUCCESS",
      recipients: otherMemberships.map((m) => ({
        userId: m.userId,
        message: `${payerDisplayName} • ${sessionLabel} : « J'ai cotisé, merci la team ! »`,
        messageKey: "memberPaidGroupCelebration",
        messageVars: { member: payerDisplayName, session: sessionLabel },
        actionUrl: `/sessions/${membership.tontineSessionId}`,
      })),
    });
  }

  // When half of the members have contributed for this cycle, if the designated beneficiary
  // has already drawn their lucky ball, alert them to submit their payout details.
  try {
    const designatedSlot = await prisma.membershipSlot.findFirst({
      where: {
        membership: { tontineSessionId: membership.tontineSessionId, status: "APPROVED" },
        officialPosition: { not: null },
        ballDrawn: { not: null },
        payouts: { none: {} },
      },
      include: {
        membership: { include: { user: true } },
      },
      orderBy: { officialPosition: "asc" },
    });

    if (designatedSlot) {
      const allApprovedSlots = await prisma.membershipSlot.findMany({
        where: { membership: { tontineSessionId: membership.tontineSessionId, status: "APPROVED" } },
        select: { id: true },
      });
      const halfThreshold = Math.ceil(allApprovedSlots.length / 2);
      const paidCount = await prisma.contribution.count({
        where: {
          membershipSlotId: { in: allApprovedSlots.map((s) => s.id) },
          dueDate: contribution.dueDate,
          status: "PAID",
        },
      });

      if (paidCount === halfThreshold) {
        const benUser = designatedSlot.membership.user;
        const benLang: Lang = benUser.preferredLang === "en" ? "en" : "fr";
        const alertMsg =
          benLang === "fr"
            ? `C'est votre tour de bouffer la cagnotte de ${sessionLabel} ! La moitié des membres a cotisé : veuillez fournir votre numéro de compte Mobile Money ou Orange Money et votre nom complet.`
            : `It's your turn to receive the ${sessionLabel} payout! Half of the members have contributed: please provide your Mobile Money or Orange Money account number and name.`;

        await scheduleInAppNotifications({
          tontineSessionId: membership.tontineSessionId,
          type: "PAYOUT_TURN",
          recipients: [
            {
              userId: benUser.id,
              message: alertMsg,
              messageKey: "payoutTurnNotifMessage",
              messageVars: { cotisation: sessionLabel },
              actionUrl: `/sessions/${membership.tontineSessionId}`,
            },
          ],
        });
        if (benUser.phone) {
          await sendWhatsAppMessageSafe(benUser.phone, alertMsg);
        }
      }
    }
  } catch (err) {
    console.error("[settleContribution] 50% milestone alert failed:", err);
  }

  // The payer gets their own confirmation too, when they aren't the
  // beneficiary themselves (relative/friend paying via their own code) —
  // in their OWN preferredLang, not the beneficiary's.
  if (contribution.paidByUser && contribution.paidByUser.id !== user.id) {
    const payerLang: Lang = contribution.paidByUser.preferredLang === "en" ? "en" : "fr";
    const beneficiaryLabel = `${user.name} (${contribution.membershipSlot.beneficiaryName})`;

    // In-app & push notification to the relative's phone
    await scheduleInAppNotifications({
      tontineSessionId: membership.tontineSessionId,
      type: "PAYMENT_SUCCESS",
      recipients: [
        {
          userId: contribution.paidByUser.id,
          message:
            payerLang === "en"
              ? `Your contribution of ${formatXAF(totalPaid)} for ${beneficiaryLabel} in ${sessionLabel} was successful! Receipt is available.`
              : `Votre cotisation de ${formatXAF(totalPaid)} pour ${beneficiaryLabel} dans ${sessionLabel} a été validée avec succès ! Votre reçu est disponible.`,
          messageKey: "relativePaymentSuccessNotif",
          messageVars: {
            amount: formatXAF(totalPaid),
            beneficiary: beneficiaryLabel,
            session: sessionLabel,
          },
          actionUrl: "/history",
        },
      ],
    });

    await sendEmailSafe(
      contribution.paidByUser.email,
      translate(payerLang, "paymentSentEmailSubject", { session: sessionLabel }),
      paymentSuccessEmailHtml(payerLang, {
        recipientName: contribution.paidByUser.name,
        beneficiaryName: contribution.membershipSlot.beneficiaryName,
        paidByName: contribution.paidByUser.name,
        sessionLabel,
        amount: totalPaid,
        transRef: contribution.fapshiTxRef ?? contribution.id,
        receiptUrl,
      }),
    );
    if (contribution.paidByUser.phone) {
      await sendWhatsAppMessageSafe(
        contribution.paidByUser.phone,
        paymentSuccessMessage(
          payerLang,
          `${contribution.paidByUser.name} (pour ${contribution.membershipSlot.beneficiaryName})`,
          totalPaid,
          sessionLabel,
          receiptUrl,
        ),
      );
    }
  }
}

function paymentSuccessEmailHtml(
  lang: Lang,
  data: {
    recipientName: string;
    beneficiaryName: string;
    paidByName?: string;
    sessionLabel: string;
    amount: number;
    transRef: string;
    receiptUrl: string;
  },
): string {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const paidByLine = data.paidByName ? `<p><strong>${t("paidByLabel")}:</strong> ${data.paidByName}</p>` : "";
  return `
    <p>${t("paymentReceivedEmailGreeting", { name: data.recipientName })}</p>
    <p>${t("paymentReceivedEmailIntro")}</p>
    <p><strong>${t("contributedForLabel")}:</strong> ${data.beneficiaryName}</p>
    ${paidByLine}
    <p><strong>${t("contributionLabel")}:</strong> ${data.sessionLabel}</p>
    <p><strong>${t("amountLabel")}:</strong> ${formatXAF(data.amount)}</p>
    <p><strong>${t("transactionIdLabel")}:</strong> ${data.transRef}</p>
    <p><a href="${data.receiptUrl}">${t("downloadReceiptPdf")}</a></p>
    <p>${t("thankYouContributionLine")}</p>
  `;
}
