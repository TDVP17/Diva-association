import type { TontineType } from "@/generated/prisma/enums";
import { CAMEROON_TIME_ZONE, CUTOFF_HOUR, CUTOFF_MINUTE } from "@/lib/constants";

export interface TontineConfig {
  amount: number;
  fee: number;
  /** President/winner split of the service fee (75%/25%) — applies to every type; kept nullable for a future type that might opt out. */
  feeSplit: { presidentShare: number; winnerShare: number } | null;
  fineAmountPerPeriod: number;
  fineIntervalHours: number;
}

export const TONTINE_CONFIG: Record<TontineType, TontineConfig> = {
  HEBDO_SUNDAY: {
    amount: 2500,
    fee: 100,
    feeSplit: { presidentShare: 75, winnerShare: 25 },
    fineAmountPerPeriod: 500,
    fineIntervalHours: 24,
  },
  MONTHLY_28: {
    amount: 20000,
    fee: 500,
    feeSplit: { presidentShare: 75, winnerShare: 25 },
    fineAmountPerPeriod: 2500,
    fineIntervalHours: 24,
  },
  MONTHLY_25: {
    amount: 30000,
    fee: 750,
    feeSplit: { presidentShare: 75, winnerShare: 25 },
    fineAmountPerPeriod: 5000,
    fineIntervalHours: 24,
  },
  BIWEEKLY_SUNDAY: {
    amount: 5000,
    fee: 150,
    feeSplit: { presidentShare: 75, winnerShare: 25 },
    fineAmountPerPeriod: 500,
    fineIntervalHours: 24,
  },
  QUARTERLY_25: {
    amount: 75000,
    fee: 1500,
    feeSplit: { presidentShare: 75, winnerShare: 25 },
    fineAmountPerPeriod: 7500,
    fineIntervalHours: 24,
  },
};

export function getTontineConfig(type: TontineType): TontineConfig {
  return TONTINE_CONFIG[type];
}

/**
 * Splits a session's total collected service fees between the President and
 * the round's winner, using the percentages in TontineConfig.feeSplit (e.g.
 * 75/25). presidentShare/winnerShare are percentages of totalFees, not
 * amounts to prorate against the fee-per-contribution — winner is derived
 * by subtraction so the two shares always sum exactly to totalFees, with no
 * rounding drift.
 */
export function computeFeeSplitAmounts(
  totalFees: number,
  feeSplit: { presidentShare: number; winnerShare: number },
): { president: number; winner: number } {
  const president = Math.round((totalFees * feeSplit.presidentShare) / 100);
  return { president, winner: totalFees - president };
}

/**
 * Uses the session's own `amount`/`fee` columns (admin-configurable at
 * creation time), not the `TONTINE_CONFIG` preset — that table is now only
 * a form-prefill default, not the source of truth for what a member owes.
 */
export function getContributionTotal(session: { amount: number; fee: number }): {
  amount: number;
  fee: number;
  total: number;
} {
  return { amount: session.amount, fee: session.fee, total: session.amount + session.fee };
}

/**
 * Cameroon (Africa/Douala, WAT) is UTC+1 year-round with no DST, so the
 * offset can be hardcoded instead of pulling in a timezone-arithmetic
 * library just for this one fixed conversion.
 */
const CAMEROON_UTC_OFFSET_HOURS = 1;

function getCameroonDateParts(date: Date): { year: number; month: number; day: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CAMEROON_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: weekdayMap[get("weekday")] ?? -1,
  };
}

/** Normalizes a Cameroon-local calendar date to a UTC midnight `Date`, usable as a stable cycle key. */
export function toDueDateKey(date: Date): Date {
  const { year, month, day } = getCameroonDateParts(date);
  return new Date(Date.UTC(year, month - 1, day));
}

/** The next date (today included) that is a contribution day for `type`, in Cameroon local time. */
export function getNextDueDate(type: TontineType, from: Date): Date {
  const cursor = new Date(from);
  for (let i = 0; i < 32; i++) {
    if (isContributionDay(type, cursor)) {
      return toDueDateKey(cursor);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  throw new Error(`Could not determine next due date for ${type}`);
}

/** The most recent date (today included) that was a contribution day for `type` — the cycle that just closed. */
export function getMostRecentDueDate(type: TontineType, from: Date): Date {
  const cursor = new Date(from);
  for (let i = 0; i < 32; i++) {
    if (isContributionDay(type, cursor)) {
      return toDueDateKey(cursor);
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  throw new Error(`Could not determine most recent due date for ${type}`);
}

/** The contribution-day cycle immediately before `dueDate` — never returns `dueDate` itself. */
export function getPreviousDueDate(type: TontineType, dueDate: Date): Date {
  const cursor = new Date(dueDate);
  cursor.setUTCDate(cursor.getUTCDate() - 1);
  return getMostRecentDueDate(type, cursor);
}

// A known Sunday, used only as a fixed phase reference for BIWEEKLY_SUNDAY
// — every type here is a calendar-fixed schedule (not anchored to any
// individual session's startDate), consistent with how HEBDO_SUNDAY/
// MONTHLY_25/MONTHLY_28 already work.
const BIWEEKLY_REFERENCE_SUNDAY = Date.UTC(2024, 0, 7);
const QUARTERLY_MONTHS = [1, 4, 7, 10]; // January, April, July, October

/** Whether `date` (evaluated in Cameroon local time) is a contribution day for `type`. */
export function isContributionDay(type: TontineType, date: Date): boolean {
  const { day, month, weekday } = getCameroonDateParts(date);
  switch (type) {
    case "HEBDO_SUNDAY":
      return weekday === 0;
    case "MONTHLY_28":
      return day === 28;
    case "MONTHLY_25":
      return day === 25;
    case "BIWEEKLY_SUNDAY": {
      if (weekday !== 0) return false;
      const dueDateUtc = toDueDateKey(date).getTime();
      const weeksSinceReference = Math.round((dueDateUtc - BIWEEKLY_REFERENCE_SUNDAY) / (7 * 24 * 60 * 60 * 1000));
      return weeksSinceReference % 2 === 0;
    }
    case "QUARTERLY_25":
      return day === 25 && QUARTERLY_MONTHS.includes(month);
  }
}

/** The 18:31 Cameroon-time cutoff instant for the calendar day `date` falls on. */
export function getCutoffInstant(date: Date): Date {
  const { year, month, day } = getCameroonDateParts(date);
  return new Date(
    Date.UTC(year, month - 1, day, CUTOFF_HOUR - CAMEROON_UTC_OFFSET_HOURS, CUTOFF_MINUTE),
  );
}

/**
 * Outstanding fine for a contribution still unpaid at `now`, relative to
 * its `cutoff`. `override` is a session's own fineAmountPerPeriod/
 * fineIntervalHours (admin-configurable per cotisation) — falls back to
 * the global TONTINE_CONFIG table when the session predates that field.
 */
export function computeFine(
  type: TontineType,
  now: Date,
  cutoff: Date,
  override?: { fineAmountPerPeriod: number | null; fineIntervalHours: number | null },
): number {
  const hoursLate = (now.getTime() - cutoff.getTime()) / (1000 * 60 * 60);
  if (hoursLate <= 0) return 0;
  const fallback = getTontineConfig(type);
  const fineAmountPerPeriod = override?.fineAmountPerPeriod ?? fallback.fineAmountPerPeriod;
  const fineIntervalHours = override?.fineIntervalHours ?? fallback.fineIntervalHours;
  const periodsLate = Math.ceil(hoursLate / fineIntervalHours);
  return periodsLate * fineAmountPerPeriod;
}

/**
 * The Nth contribution-cycle date after `startDate` (1-indexed) — purely
 * for DISPLAY next to a payout position in the ranking tools. Does not
 * affect how Payout.dueDate actually gets set (still computed live via
 * getMostRecentDueDate at claim-submission time) — this is an estimate
 * shown to admins/members before that happens.
 */
export function getCycleDateForRound(type: TontineType, startDate: Date, round: number): Date {
  let cursor = getNextDueDate(type, startDate);
  for (let i = 1; i < round; i++) {
    const next = new Date(cursor);
    next.setUTCDate(next.getUTCDate() + 1);
    cursor = getNextDueDate(type, next);
  }
  return cursor;
}
