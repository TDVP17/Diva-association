import type { Contribution, Membership, MembershipSlot, TontineSession, User } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { generateReceiptPdf } from "@/lib/receipt";
import { saveFile } from "@/lib/storage";
import { sendWhatsAppMessageSafe } from "@/lib/whatsapp/evolution";
import { paymentSuccessMessage } from "@/lib/whatsapp/templates";

type ContributionWithSlot = Contribution & {
  membershipSlot: MembershipSlot & {
    membership: Membership & { user: User; tontineSession: TontineSession };
  };
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

  const receiptBytes = await generateReceiptPdf({
    memberName: `${user.name} — ${contribution.membershipSlot.beneficiaryName}`,
    tontineType: tontineSession.type,
    amount: Number(contribution.amountPaid),
    fee: Number(contribution.feePaid),
    fine: Number(contribution.finePaid),
    total: Number(contribution.amountPaid) + Number(contribution.feePaid) + Number(contribution.finePaid),
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
    Number(contribution.amountPaid) + Number(contribution.feePaid) + Number(contribution.finePaid);
  await sendWhatsAppMessageSafe(
    user.phone,
    paymentSuccessMessage(
      `${user.name} (${contribution.membershipSlot.beneficiaryName})`,
      totalPaid,
      `${options.origin}/api/files/${receiptKey}`,
    ),
  );
}
