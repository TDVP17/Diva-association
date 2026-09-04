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
    paymentMethod: contribution.recordedByAdminId ? "Recorded by admin" : "Mobile Money (Fapshi)",
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
  const recipientLang: Lang = user.preferredLang === "fr" ? "fr" : "en";

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

  // The payer gets their own confirmation too, when they aren't the
  // beneficiary themselves (relative/friend paying via their own code) —
  // in their OWN preferredLang, not the beneficiary's.
  if (contribution.paidByUser && contribution.paidByUser.id !== user.id) {
    const payerLang: Lang = contribution.paidByUser.preferredLang === "fr" ? "fr" : "en";
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
