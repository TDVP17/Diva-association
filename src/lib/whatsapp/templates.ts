import type { TontineType } from "@/generated/prisma/enums";
import { translate, type Lang } from "@/lib/i18n/translations";
import { TONTINE_TYPE_LABELS as TONTINE_LABELS } from "@/lib/tontine-labels";
import { formatXAF } from "@/lib/format-currency";

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
