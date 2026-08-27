import type { Contribution, Membership, MembershipSlot, TontineSession, User } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { generateReceiptPdf } from "@/lib/receipt";
import { saveFile } from "@/lib/storage";
import { sendWhatsAppMessageSafe } from "@/lib/whatsapp/evolution";
import { sendEmailSafe } from "@/lib/email/resend";
import { paymentSuccessMessage } from "@/lib/whatsapp/templates";

const TONTINE_LABELS: Record<string, string> = {
  HEBDO_SUNDAY: "Weekly Tontine (Sunday)",
  MONTHLY_28: "Monthly Tontine (28th)",
  MONTHLY_25: "Monthly Tontine (25th)",
};

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
  const sessionLabel = tontineSession.title || TONTINE_LABELS[tontineSession.type];
  const receiptUrl = `${options.origin}/api/files/${receiptKey}`;

  await sendWhatsAppMessageSafe(
    user.phone,
    paymentSuccessMessage(
      user.preferredLang === "fr" ? "fr" : "en",
      `${user.name} (${contribution.membershipSlot.beneficiaryName})`,
      totalPaid,
      sessionLabel,
      receiptUrl,
    ),
  );

  await sendEmailSafe(
    user.email,
    `Payment received — ${sessionLabel}`,
    paymentSuccessEmailHtml({
      recipientName: user.name,
      beneficiaryName: contribution.membershipSlot.beneficiaryName,
      paidByName,
      sessionLabel,
      amount: totalPaid,
      transRef: contribution.fapshiTxRef ?? contribution.id,
      receiptUrl,
    }),
  );

  // The payer gets their own confirmation too, when they aren't the
  // beneficiary themselves (relative/friend paying via their own code).
  if (contribution.paidByUser && contribution.paidByUser.id !== user.id) {
    await sendEmailSafe(
      contribution.paidByUser.email,
      `Payment sent — ${sessionLabel}`,
      paymentSuccessEmailHtml({
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

function paymentSuccessEmailHtml(data: {
  recipientName: string;
  beneficiaryName: string;
  paidByName?: string;
  sessionLabel: string;
  amount: number;
  transRef: string;
  receiptUrl: string;
}): string {
  const paidByLine = data.paidByName ? `<p><strong>Paid by:</strong> ${data.paidByName}</p>` : "";
  return `
    <p>Hello ${data.recipientName},</p>
    <p>🎉 Your contribution has been received successfully.</p>
    <p><strong>Contributed for:</strong> ${data.beneficiaryName}</p>
    ${paidByLine}
    <p><strong>Contribution:</strong> ${data.sessionLabel}</p>
    <p><strong>Amount:</strong> ${data.amount.toLocaleString("en-US")} F</p>
    <p><strong>Transaction ID:</strong> ${data.transRef}</p>
    <p><a href="${data.receiptUrl}">Download your PDF receipt</a></p>
    <p>Thank you for your contribution to the community fund.</p>
  `;
}
