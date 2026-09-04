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

/**
 * Sent once, right when a member becomes the newly-designated beneficiary
 * (see getDesignatedSlot) — a heads-up that their turn is coming, not a
 * confirmation that money has moved (that's the separate "payout released"
 * message in the admin release route). `amount` is an estimate (per-slot
 * contribution × registered slots), since this fires before that cycle's
 * contributions are actually collected.
 */
export function payoutTurnMessage(
  lang: Lang,
  firstName: string,
  cotisationName: string,
  estimatedAmount: number,
  expectedDateLabel: string,
  position: number,
): string {
  return translate(lang, "waPayoutTurn", {
    name: firstName,
    amount: formatXAF(estimatedAmount),
    cotisation: cotisationName,
    date: expectedDateLabel,
    position: String(position),
  });
}

/** Sent right when an admin releases a payout — confirms the transfer to the beneficiary who was just paid. */
export function payoutReleasedMessage(
  lang: Lang,
  memberName: string,
  beneficiaryName: string,
  netPayout: number,
  deducted: number,
): string {
  return deducted > 0
    ? translate(lang, "waPayoutReleasedWithDeduction", {
        name: memberName,
        beneficiary: beneficiaryName,
        amount: formatXAF(netPayout),
        deducted: formatXAF(deducted),
      })
    : translate(lang, "waPayoutReleased", {
        name: memberName,
        beneficiary: beneficiaryName,
        amount: formatXAF(netPayout),
      });
}

/**
 * Sent the day before the currently-designated beneficiary's ESTIMATED
 * payout date (see getCycleDateForRound) — a reminder distinct from
 * payoutTurnMessage above, which fires once, right when they first become
 * designated (possibly weeks earlier).
 */
export function turnReminderTomorrowMessage(
  lang: Lang,
  firstName: string,
  cotisationName: string,
  position: number,
  estimatedAmount: number,
  tomorrowDateLabel: string,
): string {
  return translate(lang, "waTurnReminderTomorrow", {
    name: firstName,
    cotisation: cotisationName,
    position: String(position),
    amount: formatXAF(estimatedAmount),
    date: tomorrowDateLabel,
  });
}
