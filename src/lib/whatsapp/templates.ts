import type { TontineType } from "@/generated/prisma/enums";
import { translate, type Lang } from "@/lib/i18n/translations";

const TONTINE_LABELS: Record<TontineType, string> = {
  HEBDO_SUNDAY: "Weekly Tontine (Sunday)",
  MONTHLY_28: "Monthly Tontine (28th)",
  MONTHLY_25: "Monthly Tontine (25th)",
};

function formatXAF(amount: number): string {
  return `${amount.toLocaleString("en-US")} F`;
}

export function reminderNoonMessage(
  lang: Lang,
  memberName: string,
  type: TontineType,
  amount: number,
): string {
  return translate(lang, "waReminderNoon", {
    name: memberName,
    amount: formatXAF(amount),
    cotisation: TONTINE_LABELS[type],
  });
}

export function reminderUrgentMessage(
  lang: Lang,
  memberName: string,
  type: TontineType,
  amount: number,
): string {
  return translate(lang, "waReminderUrgent", {
    name: memberName,
    amount: formatXAF(amount),
    cotisation: TONTINE_LABELS[type],
  });
}

export function paymentSuccessMessage(
  lang: Lang,
  memberName: string,
  totalPaid: number,
  cotisationName: string,
  receiptUrl: string,
): string {
  return translate(lang, "waPaymentSuccess", {
    name: memberName,
    amount: formatXAF(totalPaid),
    cotisation: cotisationName,
    receiptUrl,
  });
}

export function fineNoticeMessage(
  lang: Lang,
  memberName: string,
  type: TontineType,
  fineAmount: number,
): string {
  return translate(lang, "waFineNotice", {
    name: memberName,
    amount: formatXAF(fineAmount),
    cotisation: TONTINE_LABELS[type],
  });
}
