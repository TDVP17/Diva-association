import type { TontineType } from "@/generated/prisma/enums";

const TONTINE_LABELS: Record<TontineType, string> = {
  HEBDO_SUNDAY: "Weekly Tontine (Sunday)",
  MONTHLY_28: "Monthly Tontine (28th)",
  MONTHLY_25: "Monthly Tontine (25th)",
};

function formatXAF(amount: number): string {
  return `${amount.toLocaleString("en-US")} F`;
}

export function reminderNoonMessage(memberName: string, type: TontineType, amount: number): string {
  return (
    `Hi ${memberName}, this is a friendly reminder from DIVA Associations 🌿\n\n` +
    `Your contribution of ${formatXAF(amount)} for the ${TONTINE_LABELS[type]} is due today. ` +
    `You have until 18:30 to pay before a late fine applies.\n\n` +
    `Thank you for staying on track with the community!`
  );
}

export function reminderUrgentMessage(memberName: string, type: TontineType, amount: number): string {
  return (
    `⚠️ URGENT — DIVA Associations\n\n` +
    `${memberName}, your ${formatXAF(amount)} contribution for the ${TONTINE_LABELS[type]} is still unpaid. ` +
    `The 18:30 deadline is approaching — after 18:31 a late fine will automatically apply.\n\n` +
    `Please complete your payment now to avoid the fine.`
  );
}

export function paymentSuccessMessage(
  memberName: string,
  totalPaid: number,
  receiptUrl: string,
): string {
  return (
    `✅ Payment received — DIVA Associations\n\n` +
    `Thank you, ${memberName}! We've confirmed your payment of ${formatXAF(totalPaid)}.\n\n` +
    `Download your receipt: ${receiptUrl}`
  );
}

export function fineNoticeMessage(memberName: string, type: TontineType, fineAmount: number): string {
  return (
    `🔴 Late payment notice — DIVA Associations\n\n` +
    `${memberName}, your contribution for the ${TONTINE_LABELS[type]} was not received before the 18:30 deadline. ` +
    `A late fine of ${formatXAF(fineAmount)} has been applied to your account.\n\n` +
    `Please settle your contribution and fine as soon as possible.`
  );
}
