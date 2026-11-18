import type { TontineType } from "@/generated/prisma/enums";

const WEEKDAY_NAMES_FR = [
  "dimanche",
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
];

/** Maps weekly / biweekly TontineType to JS UTC weekday (0=Sunday .. 6=Saturday). */
const WEEKLY_DAY_MAP: Partial<Record<TontineType, number>> = {
  HEBDO_SUNDAY: 0,
  BIWEEKLY_SUNDAY: 0,
  EVERY_MONDAY: 1,
  BIWEEKLY_MONDAY: 1,
  EVERY_TUESDAY: 2,
  BIWEEKLY_TUESDAY: 2,
  EVERY_WEDNESDAY: 3,
  BIWEEKLY_WEDNESDAY: 3,
  EVERY_THURSDAY: 4,
  BIWEEKLY_THURSDAY: 4,
  EVERY_FRIDAY: 5,
  BIWEEKLY_FRIDAY: 5,
  EVERY_SATURDAY: 6,
  BIWEEKLY_SATURDAY: 6,
};

/** Maps monthly / quarterly TontineType to expected calendar day of month (1..28). */
const MONTHLY_DAY_MAP: Partial<Record<TontineType, number>> = {
  MONTHLY_1: 1,
  MONTHLY_5: 5,
  MONTHLY_10: 10,
  MONTHLY_15: 15,
  MONTHLY_20: 20,
  MONTHLY_25: 25,
  MONTHLY_28: 28,
  QUARTERLY_25: 25,
};

function parseDateYMD(input: string | Date): { year: number; month: number; day: number; utcDate: Date } | null {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    const year = input.getUTCFullYear();
    const month = input.getUTCMonth() + 1;
    const day = input.getUTCDate();
    return { year, month, day, utcDate: new Date(Date.UTC(year, month - 1, day, 12, 0, 0)) };
  }

  const trimmed = input.trim();
  const ymdMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymdMatch) {
    const year = Number(ymdMatch[1]);
    const month = Number(ymdMatch[2]);
    const day = Number(ymdMatch[3]);
    const utcDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    if (
      utcDate.getUTCFullYear() !== year ||
      utcDate.getUTCMonth() + 1 !== month ||
      utcDate.getUTCDate() !== day
    ) {
      return null;
    }
    return { year, month, day, utcDate };
  }

  const fallback = new Date(trimmed);
  if (Number.isNaN(fallback.getTime())) return null;
  return parseDateYMD(fallback);
}

function formatYMD(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function getCycleDateConstraint(type: TontineType): {
  kind: "weekday" | "dayOfMonth";
  value: number;
  expectedLabel: string;
} {
  const weekday = WEEKLY_DAY_MAP[type];
  if (weekday !== undefined) {
    return {
      kind: "weekday",
      value: weekday,
      expectedLabel: `un ${WEEKDAY_NAMES_FR[weekday]}`,
    };
  }
  const dayOfMonth = MONTHLY_DAY_MAP[type] ?? 1;
  return {
    kind: "dayOfMonth",
    value: dayOfMonth,
    expectedLabel: `le ${dayOfMonth}${dayOfMonth === 1 ? "er" : ""} du mois`,
  };
}

/**
 * Returns the next `count` valid YYYY-MM-DD start dates matching `type`, starting from `fromDate`.
 */
export function getNextValidStartDates(
  type: TontineType,
  count: number = 12,
  fromDate: Date = new Date(),
): string[] {
  const constraint = getCycleDateConstraint(type);
  const results: string[] = [];

  // Start from tomorrow in Cameroon time (UTC+1)
  const cmr = new Date(fromDate.getTime() + 60 * 60 * 1000);
  const cursor = new Date(Date.UTC(cmr.getUTCFullYear(), cmr.getUTCMonth(), cmr.getUTCDate(), 12, 0, 0));

  if (constraint.kind === "weekday") {
    let guard = 0;
    while (results.length < count && guard < 400) {
      if (cursor.getUTCDay() === constraint.value) {
        results.push(formatYMD(cursor));
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      guard += 1;
    }
    return results;
  }

  // Monthly / quarterly: find matching day of month
  let y = cursor.getUTCFullYear();
  let m = cursor.getUTCMonth();
  const todayDay = cursor.getUTCDate();
  if (todayDay > constraint.value) {
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  for (let i = 0; i < count; i++) {
    const candidate = new Date(Date.UTC(y, m, constraint.value, 12, 0, 0));
    results.push(formatYMD(candidate));
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return results;
}

/**
 * Strictly validates that `dateInput` respects the selected contribution cycle (`type`).
 * Used on BOTH frontend and backend to prevent any mismatched start dates.
 */
export function isStartDateValidForCycle(
  type: TontineType,
  dateInput: string | Date,
  now: Date = new Date(),
): {
  valid: boolean;
  expectedLabel: string;
  nextValidDate: string;
  errorMessage: string | null;
} {
  const constraint = getCycleDateConstraint(type);
  const nextValidDate = getNextValidStartDates(type, 1, now)[0]!;
  const parsed = parseDateYMD(dateInput);

  if (!parsed) {
    return {
      valid: false,
      expectedLabel: constraint.expectedLabel,
      nextValidDate,
      errorMessage: `Date de début invalide. Veuillez choisir ${constraint.expectedLabel}.`,
    };
  }

  if (constraint.kind === "weekday") {
    const actualWeekday = parsed.utcDate.getUTCDay();
    if (actualWeekday !== constraint.value) {
      return {
        valid: false,
        expectedLabel: constraint.expectedLabel,
        nextValidDate,
        errorMessage: `La date choisie tombe un ${WEEKDAY_NAMES_FR[actualWeekday]}. Pour ce cycle, la date de début doit obligatoirement être ${constraint.expectedLabel}.`,
      };
    }
    return { valid: true, expectedLabel: constraint.expectedLabel, nextValidDate, errorMessage: null };
  }

  if (parsed.day !== constraint.value) {
    return {
      valid: false,
      expectedLabel: constraint.expectedLabel,
      nextValidDate,
      errorMessage: `La date choisie tombe le ${parsed.day} du mois. Pour ce cycle, la date de début doit obligatoirement être ${constraint.expectedLabel}.`,
    };
  }

  return { valid: true, expectedLabel: constraint.expectedLabel, nextValidDate, errorMessage: null };
}

