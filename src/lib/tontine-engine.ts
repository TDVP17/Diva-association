import type { TontineType } from "@/generated/prisma/enums";
import { CAMEROON_TIME_ZONE, CUTOFF_HOUR, CUTOFF_MINUTE } from "@/lib/constants";

export interface TontineConfig {
  amount: number;
  fee: number;
  /** Only defined where the spec calls out an explicit fee split. */
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
    feeSplit: null,
    fineAmountPerPeriod: 2500,
    fineIntervalHours: 24,
  },
  MONTHLY_25: {
    amount: 30000,
    fee: 750,
    feeSplit: null,
    fineAmountPerPeriod: 5000,
    fineIntervalHours: 24,
  },
};

export function getTontineConfig(type: TontineType): TontineConfig {
  return TONTINE_CONFIG[type];
}

export function getContributionTotal(type: TontineType): {
  amount: number;
  fee: number;
  total: number;
} {
  const { amount, fee } = getTontineConfig(type);
  return { amount, fee, total: amount + fee };
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

/** Whether `date` (evaluated in Cameroon local time) is a contribution day for `type`. */
export function isContributionDay(type: TontineType, date: Date): boolean {
  const { day, weekday } = getCameroonDateParts(date);
  switch (type) {
    case "HEBDO_SUNDAY":
      return weekday === 0;
    case "MONTHLY_28":
      return day === 28;
    case "MONTHLY_25":
      return day === 25;
  }
}

/** The 18:31 Cameroon-time cutoff instant for the calendar day `date` falls on. */
export function getCutoffInstant(date: Date): Date {
  const { year, month, day } = getCameroonDateParts(date);
  return new Date(
    Date.UTC(year, month - 1, day, CUTOFF_HOUR - CAMEROON_UTC_OFFSET_HOURS, CUTOFF_MINUTE),
  );
}

/** Outstanding fine for a contribution still unpaid at `now`, relative to its `cutoff`. */
export function computeFine(type: TontineType, now: Date, cutoff: Date): number {
  const hoursLate = (now.getTime() - cutoff.getTime()) / (1000 * 60 * 60);
  if (hoursLate <= 0) return 0;
  const { fineAmountPerPeriod, fineIntervalHours } = getTontineConfig(type);
  const periodsLate = Math.ceil(hoursLate / fineIntervalHours);
  return periodsLate * fineAmountPerPeriod;
}
