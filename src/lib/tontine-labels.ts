import type { TontineType } from "@/generated/prisma/enums";
import { translate, type Lang } from "@/lib/i18n/translations";

/**
 * Canonical English fallback label per TontineType — only ever shown when a
 * session has no admin-provided title, which in practice is rare (title is
 * required at creation). Kept exhaustive (Record<TontineType, string>) so
 * adding a new frequency to the schema fails the build here instead of
 * silently falling through to the raw enum string somewhere.
 */
export const TONTINE_TYPE_LABELS: Record<TontineType, string> = {
  HEBDO_SUNDAY: "Weekly Tontine (Sunday)",
  EVERY_MONDAY: "Weekly Tontine (Monday)",
  EVERY_TUESDAY: "Weekly Tontine (Tuesday)",
  EVERY_WEDNESDAY: "Weekly Tontine (Wednesday)",
  EVERY_THURSDAY: "Weekly Tontine (Thursday)",
  EVERY_FRIDAY: "Weekly Tontine (Friday)",
  EVERY_SATURDAY: "Weekly Tontine (Saturday)",
  MONTHLY_1: "Monthly Tontine (1st)",
  MONTHLY_5: "Monthly Tontine (5th)",
  MONTHLY_10: "Monthly Tontine (10th)",
  MONTHLY_15: "Monthly Tontine (15th)",
  MONTHLY_20: "Monthly Tontine (20th)",
  MONTHLY_25: "Monthly Tontine (25th)",
  MONTHLY_28: "Monthly Tontine (28th)",
  BIWEEKLY_SUNDAY: "Every 2 Weeks (Sunday)",
  BIWEEKLY_MONDAY: "Every 2 Weeks (Monday)",
  BIWEEKLY_TUESDAY: "Every 2 Weeks (Tuesday)",
  BIWEEKLY_WEDNESDAY: "Every 2 Weeks (Wednesday)",
  BIWEEKLY_THURSDAY: "Every 2 Weeks (Thursday)",
  BIWEEKLY_FRIDAY: "Every 2 Weeks (Friday)",
  BIWEEKLY_SATURDAY: "Every 2 Weeks (Saturday)",
  QUARTERLY_25: "Every 3 Months (25th)",
};

const WEEKDAY_KEY = {
  Sunday: "weekdaySunday",
  Monday: "weekdayMonday",
  Tuesday: "weekdayTuesday",
  Wednesday: "weekdayWednesday",
  Thursday: "weekdayThursday",
  Friday: "weekdayFriday",
  Saturday: "weekdaySaturday",
} as const;

/** { group: label, options: [{ value, label }] } — for the creation form's grouped <select>, in the current UI language. */
export function getFrequencyOptionGroups(lang: Lang): { group: string; options: { value: TontineType; label: string }[] }[] {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const weekday = (name: keyof typeof WEEKDAY_KEY) => t(WEEKDAY_KEY[name]);

  return [
    {
      group: t("frequencyGroupWeekly"),
      options: [
        { value: "HEBDO_SUNDAY", label: weekday("Sunday") },
        { value: "EVERY_MONDAY", label: weekday("Monday") },
        { value: "EVERY_TUESDAY", label: weekday("Tuesday") },
        { value: "EVERY_WEDNESDAY", label: weekday("Wednesday") },
        { value: "EVERY_THURSDAY", label: weekday("Thursday") },
        { value: "EVERY_FRIDAY", label: weekday("Friday") },
        { value: "EVERY_SATURDAY", label: weekday("Saturday") },
      ],
    },
    {
      group: t("frequencyGroupBiweekly"),
      options: [
        { value: "BIWEEKLY_SUNDAY", label: weekday("Sunday") },
        { value: "BIWEEKLY_MONDAY", label: weekday("Monday") },
        { value: "BIWEEKLY_TUESDAY", label: weekday("Tuesday") },
        { value: "BIWEEKLY_WEDNESDAY", label: weekday("Wednesday") },
        { value: "BIWEEKLY_THURSDAY", label: weekday("Thursday") },
        { value: "BIWEEKLY_FRIDAY", label: weekday("Friday") },
        { value: "BIWEEKLY_SATURDAY", label: weekday("Saturday") },
      ],
    },
    {
      group: t("frequencyGroupMonthly"),
      options: [
        { value: "MONTHLY_1", label: t("dayOfMonthLabel", { day: "1" }) },
        { value: "MONTHLY_5", label: t("dayOfMonthLabel", { day: "5" }) },
        { value: "MONTHLY_10", label: t("dayOfMonthLabel", { day: "10" }) },
        { value: "MONTHLY_15", label: t("dayOfMonthLabel", { day: "15" }) },
        { value: "MONTHLY_20", label: t("dayOfMonthLabel", { day: "20" }) },
        { value: "MONTHLY_25", label: t("dayOfMonthLabel", { day: "25" }) },
        { value: "MONTHLY_28", label: t("dayOfMonthLabel", { day: "28" }) },
      ],
    },
    {
      group: t("frequencyGroupQuarterly"),
      options: [{ value: "QUARTERLY_25", label: t("dayOfMonthLabel", { day: "25" }) }],
    },
  ];
}
