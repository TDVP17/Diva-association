import type { Contribution, Membership, MembershipSlot, TontineSession, User } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { generateReceiptPdf } from "@/lib/receipt";
import { saveFile } from "@/lib/storage";
import { sendEmailSafe } from "@/lib/email/resend";
import { renderBrandedEmailHtml } from "@/lib/email/template";
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
    paymentMethod: contribution.recordedByAdminId ? "Recorded by admin" : "Mobile Money / Orange Money",
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
        const benRawName = benUser.name.trim();
        const benFirstName = benRawName.split(/\s+/)[0] || benRawName;
        const alertMsg =
          benLang === "fr"
            ? `Salut, ${benFirstName} 👋 ! C'est à votre tour de bouffer la cagnotte de ${sessionLabel} ! 🎉 La moitié des membres a cotisé : veuillez fournir votre numéro de téléphone et le nom du compte Orange/MTN Money pour recevoir votre virement.`
            : `Hello, ${benFirstName} 👋! It's your turn to receive the ${sessionLabel} payout! 🎉 Half of the members have contributed: please provide your phone number and Orange/MTN Money account name to receive your payout.`;

        await scheduleInAppNotifications({
          tontineSessionId: membership.tontineSessionId,
          type: "PAYOUT_TURN",
          recipients: [
            {
              userId: benUser.id,
              message: alertMsg,
              messageKey: "payoutTurnNotifMessage",
              messageVars: { name: benFirstName, cotisation: sessionLabel },
              actionUrl: `/sessions/${membership.tontineSessionId}`,
            },
          ],
        });
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
  const paidByLine = data.paidByName ? `<tr><td style="padding: 6px 0; color: #64748b;"><strong>${t("paidByLabel")} :</strong></td><td style="padding: 6px 0; font-weight: 600; text-align: right;">${data.paidByName}</td></tr>` : "";
  
  const bodyHtml = `
    <p style="margin-top: 0;">${t("paymentReceivedEmailGreeting", { name: data.recipientName })}</p>
    <p>${t("paymentReceivedEmailIntro")}</p>
    
    <table width="100%" style="margin: 18px 0; border-collapse: collapse; font-size: 14px;">
      <tr>
        <td style="padding: 6px 0; color: #64748b;"><strong>${t("contributedForLabel")} :</strong></td>
        <td style="padding: 6px 0; font-weight: 600; text-align: right;">${data.beneficiaryName}</td>
      </tr>
      ${paidByLine}
      <tr>
        <td style="padding: 6px 0; color: #64748b;"><strong>${t("contributionLabel")} :</strong></td>
        <td style="padding: 6px 0; font-weight: 600; text-align: right;">${data.sessionLabel}</td>
      </tr>
      <tr>
        <td style="padding: 6px 0; color: #64748b;"><strong>${t("amountLabel")} :</strong></td>
        <td style="padding: 6px 0; font-weight: 700; color: #003528; text-align: right; font-size: 16px;">${formatXAF(data.amount)}</td>
      </tr>
      <tr>
        <td style="padding: 6px 0; color: #64748b;"><strong>${t("transactionIdLabel")} :</strong></td>
        <td style="padding: 6px 0; font-family: monospace; text-align: right; font-size: 13px;">${data.transRef}</td>
      </tr>
    </table>

    <p style="margin-bottom: 0;">${t("thankYouContributionLine")}</p>
  `;

  return renderBrandedEmailHtml({
    title: t("paymentReceivedEmailSubject", { session: data.sessionLabel }),
    bodyHtml,
    actionUrl: data.receiptUrl,
    actionLabel: t("downloadReceiptPdf"),
    lang,
  });
}
