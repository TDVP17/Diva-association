// ---------------------------------------------------------------------------
// Moteur de calcul tontines, dates d'échéance et templates Cameroun (UTC+1)
// ---------------------------------------------------------------------------

export const CAMEROON_TIME_ZONE = "Africa/Douala";
export const CAMEROON_UTC_OFFSET_HOURS = 1;
export const CUTOFF_HOUR = 18;
export const CUTOFF_MINUTE = 31;
export const BIWEEKLY_REFERENCE_SUNDAY = Date.UTC(2024, 0, 7);
export const QUARTERLY_MONTHS = [1, 4, 7, 10];

export type TontineType =
  | "HEBDO_SUNDAY"
  | "EVERY_MONDAY"
  | "EVERY_TUESDAY"
  | "EVERY_WEDNESDAY"
  | "EVERY_THURSDAY"
  | "EVERY_FRIDAY"
  | "EVERY_SATURDAY"
  | "MONTHLY_1"
  | "MONTHLY_5"
  | "MONTHLY_10"
  | "MONTHLY_15"
  | "MONTHLY_20"
  | "MONTHLY_25"
  | "MONTHLY_28"
  | "BIWEEKLY_SUNDAY"
  | "BIWEEKLY_MONDAY"
  | "BIWEEKLY_TUESDAY"
  | "BIWEEKLY_WEDNESDAY"
  | "BIWEEKLY_THURSDAY"
  | "BIWEEKLY_FRIDAY"
  | "BIWEEKLY_SATURDAY"
  | "QUARTERLY_25";

export interface TontineConfig {
  amount: number;
  fee: number;
  fineAmountPerPeriod: number;
  fineIntervalHours: number;
}

const WEEKLY_DEFAULT: TontineConfig = {
  amount: 2500,
  fee: 100,
  fineAmountPerPeriod: 500,
  fineIntervalHours: 24,
};
const BIWEEKLY_DEFAULT: TontineConfig = {
  amount: 5000,
  fee: 150,
  fineAmountPerPeriod: 500,
  fineIntervalHours: 24,
};
const MONTHLY_DEFAULT: TontineConfig = {
  amount: 2500,
  fee: 600,
  fineAmountPerPeriod: 3500,
  fineIntervalHours: 24,
};

export const TONTINE_CONFIG: Record<TontineType, TontineConfig> = {
  HEBDO_SUNDAY: WEEKLY_DEFAULT,
  EVERY_MONDAY: WEEKLY_DEFAULT,
  EVERY_TUESDAY: WEEKLY_DEFAULT,
  EVERY_WEDNESDAY: WEEKLY_DEFAULT,
  EVERY_THURSDAY: WEEKLY_DEFAULT,
  EVERY_FRIDAY: WEEKLY_DEFAULT,
  EVERY_SATURDAY: WEEKLY_DEFAULT,
  MONTHLY_1: MONTHLY_DEFAULT,
  MONTHLY_5: MONTHLY_DEFAULT,
  MONTHLY_10: MONTHLY_DEFAULT,
  MONTHLY_15: MONTHLY_DEFAULT,
  MONTHLY_20: MONTHLY_DEFAULT,
  MONTHLY_28: {
    amount: 20000,
    fee: 500,
    fineAmountPerPeriod: 2500,
    fineIntervalHours: 24,
  },
  MONTHLY_25: {
    amount: 30000,
    fee: 750,
    fineAmountPerPeriod: 5000,
    fineIntervalHours: 24,
  },
  BIWEEKLY_SUNDAY: BIWEEKLY_DEFAULT,
  BIWEEKLY_MONDAY: BIWEEKLY_DEFAULT,
  BIWEEKLY_TUESDAY: BIWEEKLY_DEFAULT,
  BIWEEKLY_WEDNESDAY: BIWEEKLY_DEFAULT,
  BIWEEKLY_THURSDAY: BIWEEKLY_DEFAULT,
  BIWEEKLY_FRIDAY: BIWEEKLY_DEFAULT,
  BIWEEKLY_SATURDAY: BIWEEKLY_DEFAULT,
  QUARTERLY_25: {
    amount: 75000,
    fee: 1500,
    fineAmountPerPeriod: 7500,
    fineIntervalHours: 24,
  },
};

export const ALL_TONTINE_TYPES = Object.keys(TONTINE_CONFIG) as TontineType[];

export const TONTINE_TYPE_LABELS: Record<TontineType, string> = {
  HEBDO_SUNDAY: "Cotisation Hebdomadaire (Dimanche)",
  EVERY_MONDAY: "Cotisation Hebdomadaire (Lundi)",
  EVERY_TUESDAY: "Cotisation Hebdomadaire (Mardi)",
  EVERY_WEDNESDAY: "Cotisation Hebdomadaire (Mercredi)",
  EVERY_THURSDAY: "Cotisation Hebdomadaire (Jeudi)",
  EVERY_FRIDAY: "Cotisation Hebdomadaire (Vendredi)",
  EVERY_SATURDAY: "Cotisation Hebdomadaire (Samedi)",
  MONTHLY_1: "Cotisation Mensuelle (1er)",
  MONTHLY_5: "Cotisation Mensuelle (5)",
  MONTHLY_10: "Cotisation Mensuelle (10)",
  MONTHLY_15: "Cotisation Mensuelle (15)",
  MONTHLY_20: "Cotisation Mensuelle (20)",
  MONTHLY_25: "Cotisation Mensuelle (25)",
  MONTHLY_28: "Cotisation Mensuelle (28)",
  BIWEEKLY_SUNDAY: "Cotisation Bimensuelle (Dimanche)",
  BIWEEKLY_MONDAY: "Cotisation Bimensuelle (Lundi)",
  BIWEEKLY_TUESDAY: "Cotisation Bimensuelle (Mardi)",
  BIWEEKLY_WEDNESDAY: "Cotisation Bimensuelle (Mercredi)",
  BIWEEKLY_THURSDAY: "Cotisation Bimensuelle (Jeudi)",
  BIWEEKLY_FRIDAY: "Cotisation Bimensuelle (Vendredi)",
  BIWEEKLY_SATURDAY: "Cotisation Bimensuelle (Samedi)",
  QUARTERLY_25: "Cotisation Trimestrielle (25)",
};

export function createId(): string {
  const ts = Date.now().toString(36);
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let rand = "";
  for (const b of bytes) {
    rand += (b % 36).toString(36);
  }
  return `c${ts}${rand}`.slice(0, 25);
}

export function parseUtcDate(raw: string | Date): Date {
  if (raw instanceof Date) return raw;
  const hasTz = raw.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(raw);
  return new Date(hasTz ? raw : `${raw}Z`);
}

export function formatXAF(amount: number): string {
  const rounded = Math.round(amount);
  const formatted = rounded
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${formatted} FCFA`;
}

export function getCameroonDateParts(date: Date): {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hours: number;
  minutes: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CAMEROON_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (t: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === t)?.value ?? "";
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
    hours: Number(get("hour")),
    minutes: Number(get("minute")),
  };
}

export function toDueDateKey(date: Date): Date {
  const { year, month, day } = getCameroonDateParts(date);
  return new Date(Date.UTC(year, month - 1, day));
}

type ScheduleDescriptor =
  | { kind: "weekly"; weekday: number }
  | { kind: "biweekly"; weekday: number }
  | { kind: "monthly"; day: number }
  | { kind: "quarterly"; day: number; months: number[] };

const SCHEDULE: Record<TontineType, ScheduleDescriptor> = {
  HEBDO_SUNDAY: { kind: "weekly", weekday: 0 },
  EVERY_MONDAY: { kind: "weekly", weekday: 1 },
  EVERY_TUESDAY: { kind: "weekly", weekday: 2 },
  EVERY_WEDNESDAY: { kind: "weekly", weekday: 3 },
  EVERY_THURSDAY: { kind: "weekly", weekday: 4 },
  EVERY_FRIDAY: { kind: "weekly", weekday: 5 },
  EVERY_SATURDAY: { kind: "weekly", weekday: 6 },
  MONTHLY_1: { kind: "monthly", day: 1 },
  MONTHLY_5: { kind: "monthly", day: 5 },
  MONTHLY_10: { kind: "monthly", day: 10 },
  MONTHLY_15: { kind: "monthly", day: 15 },
  MONTHLY_20: { kind: "monthly", day: 20 },
  MONTHLY_25: { kind: "monthly", day: 25 },
  MONTHLY_28: { kind: "monthly", day: 28 },
  BIWEEKLY_SUNDAY: { kind: "biweekly", weekday: 0 },
  BIWEEKLY_MONDAY: { kind: "biweekly", weekday: 1 },
  BIWEEKLY_TUESDAY: { kind: "biweekly", weekday: 2 },
  BIWEEKLY_WEDNESDAY: { kind: "biweekly", weekday: 3 },
  BIWEEKLY_THURSDAY: { kind: "biweekly", weekday: 4 },
  BIWEEKLY_FRIDAY: { kind: "biweekly", weekday: 5 },
  BIWEEKLY_SATURDAY: { kind: "biweekly", weekday: 6 },
  QUARTERLY_25: { kind: "quarterly", day: 25, months: QUARTERLY_MONTHS },
};

export function isContributionDay(type: TontineType, date: Date): boolean {
  const { day, month, weekday } = getCameroonDateParts(date);
  const schedule = SCHEDULE[type];
  switch (schedule.kind) {
    case "weekly":
      return weekday === schedule.weekday;
    case "biweekly": {
      if (weekday !== schedule.weekday) return false;
      const dueDateUtc = toDueDateKey(date).getTime();
      const weeks = Math.round(
        (dueDateUtc - BIWEEKLY_REFERENCE_SUNDAY) / (7 * 24 * 60 * 60 * 1000),
      );
      return weeks % 2 === 0;
    }
    case "monthly":
      return day === schedule.day;
    case "quarterly":
      return day === schedule.day && schedule.months.includes(month);
  }
}

export function getNextDueDate(type: TontineType, from: Date): Date {
  const cursor = new Date(from);
  for (let i = 0; i < 120; i++) {
    if (isContributionDay(type, cursor)) {
      return toDueDateKey(cursor);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  throw new Error(`Could not determine next due date for ${type}`);
}

export function getPreviousDueDate(type: TontineType, dueDate: Date): Date {
  const cursor = new Date(dueDate);
  cursor.setUTCDate(cursor.getUTCDate() - 1);
  for (let i = 0; i < 120; i++) {
    if (isContributionDay(type, cursor)) {
      return toDueDateKey(cursor);
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  throw new Error(`Could not determine previous due date for ${type}`);
}

export function getCycleDateForRound(
  type: TontineType,
  startDate: Date,
  round: number,
): Date {
  let cursor = getNextDueDate(type, startDate);
  for (let i = 1; i < round; i++) {
    const next = new Date(cursor);
    next.setUTCDate(next.getUTCDate() + 1);
    cursor = getNextDueDate(type, next);
  }
  return cursor;
}

export function getCutoffInstant(date: Date): Date {
  const { year, month, day } = getCameroonDateParts(date);
  return new Date(
    Date.UTC(
      year,
      month - 1,
      day,
      CUTOFF_HOUR - CAMEROON_UTC_OFFSET_HOURS,
      CUTOFF_MINUTE,
    ),
  );
}

export function isPayoutInfoUnlockTime(
  dueDate: Date,
  now: Date = new Date(),
): boolean {
  const { year, month, day } = getCameroonDateParts(dueDate);
  const unlockInstant = new Date(
    Date.UTC(year, month - 1, day, 18 - CAMEROON_UTC_OFFSET_HOURS, 30),
  );
  return now.getTime() >= unlockInstant.getTime();
}

export function computeFine(
  type: TontineType,
  now: Date,
  cutoff: Date,
  override?: {
    fineAmountPerPeriod: number | null;
    fineIntervalHours: number | null;
  },
): number {
  const hoursLate = (now.getTime() - cutoff.getTime()) / (1000 * 60 * 60);
  if (hoursLate <= 0) return 0;
  const fallback = TONTINE_CONFIG[type];
  const fineAmountPerPeriod =
    override?.fineAmountPerPeriod ?? fallback.fineAmountPerPeriod;
  const fineIntervalHours =
    override?.fineIntervalHours ?? fallback.fineIntervalHours;
  const periodsLate = Math.ceil(hoursLate / fineIntervalHours);
  return periodsLate * fineAmountPerPeriod;
}

// ---------------------------------------------------------------------------
// Modèles de messages bilingues (FR / EN)
// ---------------------------------------------------------------------------

export function renderReminderEveMessage(
  lang: string,
  name: string,
  amount: number,
  cotisationTitle: string,
): string {
  if (lang === "en") {
    return `Hello, ${name} 👋\n\nFriendly reminder from DIVA Asso 🌿: your contribution of ${formatXAF(amount)} for ${cotisationTitle} is due tomorrow! You can prepare your payment or pay ahead now in peace.\n\nThank you for staying on track with the community!`;
  }
  return `Salut, ${name} 👋\n\nRappel amical de DIVA Asso 🌿 : votre cotisation de ${formatXAF(amount)} pour « ${cotisationTitle} » aura lieu demain ! Vous pouvez vous préparer ou cotiser dès maintenant en toute sérénité.\n\nMerci de rester à jour avec la communauté !`;
}

export function renderReminderNoonMessage(
  lang: string,
  name: string,
  amount: number,
  cotisationTitle: string,
): string {
  if (lang === "en") {
    return `Hello, ${name} 👋\n\nThis is a friendly reminder from DIVA Asso 🌿. Your contribution of ${formatXAF(amount)} for the ${cotisationTitle} is due today. You have until 18:30 to pay before a late fine applies.\n\nThank you for staying on track with the community!`;
  }
  return `Salut, ${name} 👋\n\nCeci est un rappel amical de DIVA Asso 🌿. Votre contribution de ${formatXAF(amount)} pour la ${cotisationTitle} est due aujourd'hui. Vous avez jusqu'à 18h30 pour payer avant qu'une amende de retard ne s'applique.\n\nMerci de rester à jour avec la communauté !`;
}

export function renderReminderUrgentMessage(
  lang: string,
  name: string,
  amount: number,
  cotisationTitle: string,
): string {
  if (lang === "en") {
    return `Hello, ${name} 👋 ⚠️ URGENT — DIVA Asso\n\nYour contribution of ${formatXAF(amount)} for the ${cotisationTitle} is still unpaid. The 18:30 deadline is approaching — after 18:31 a late fine will automatically apply.\n\nPlease complete your payment now to avoid the fine.`;
  }
  return `Salut, ${name} 👋 ⚠️ URGENT — DIVA Asso\n\nVotre contribution de ${formatXAF(amount)} pour la ${cotisationTitle} est toujours impayée. L'échéance de 18h30 approche — après 18h31, une amende de retard s'appliquera automatiquement.\n\nVeuillez effectuer votre paiement maintenant pour éviter l'amende.`;
}

export function renderFineNoticeMessage(
  lang: string,
  name: string,
  amount: number,
  cotisationTitle: string,
): string {
  if (lang === "en") {
    return `Hello, ${name} 👋 🔴 Late payment notice — DIVA Asso\n\nYour contribution for the ${cotisationTitle} was not received before the 18:30 deadline. A late fine of ${formatXAF(amount)} has been applied to your account ⚠️.\n\nPlease settle your contribution and fine as soon as possible.`;
  }
  return `Salut, ${name} 👋 🔴 Avis de retard de paiement — DIVA Asso\n\nVotre contribution pour la ${cotisationTitle} n'a pas été reçue avant l'échéance de 18h30. Une amende de retard de ${formatXAF(amount)} a été appliquée à votre compte ⚠️.\n\nVeuillez régler votre contribution et votre amende dès que possible.`;
}

export function renderFoodTurnMessage(lang: string, name: string): string {
  if (lang === "en") {
    return `Hello, ${name} 👋! It's your turn to receive the payout! 🍲🎉 All members have contributed: please provide your phone number and Orange/MTN Money account name to receive your transfer.`;
  }
  return `Salut, ${name} 👋 ! C'est votre tour de bouffer la cagnotte ! 🍲🎉 Tous les membres ont cotisé : veuillez fournir votre numéro de téléphone et le nom du compte Orange/MTN Money pour recevoir votre virement.`;
}

export function renderTurnReminderTomorrowMessage(
  lang: string,
  name: string,
  sessionTitle: string,
  estimatedAmount: number,
  position: number,
): string {
  if (lang === "en") {
    return `Hello, ${name} 👋 🎉 Tomorrow is your turn to receive the ${sessionTitle} pot (position #${position})! Estimated amount: ${formatXAF(estimatedAmount)}. Please make sure your payout details are up to date!`;
  }
  return `Salut, ${name} 👋 🎉 Demain, c'est votre tour de bouffer la cagnotte pour « ${sessionTitle} » (position n°${position}) ! Montant estimé : ${formatXAF(estimatedAmount)}. Assurez-vous que vos coordonnées de retrait sont bien renseignées !`;
}

export function renderAdvanceReminderMessage(
  lang: string,
  name: string,
  sessionTitle: string,
  amount: number,
  daysBefore: number,
): string {
  if (lang === "en") {
    return `Hello, ${name} 👋 Reminder from DIVA Asso: your contribution of ${formatXAF(amount)} for ${sessionTitle} is due in ${daysBefore} day(s). You can pay ahead now directly in the app!`;
  }
  return `Salut, ${name} 👋 Rappel DIVA Asso : votre cotisation de ${formatXAF(amount)} pour « ${sessionTitle} » arrive dans ${daysBefore} jour(s). Vous pouvez cotiser dès maintenant en toute sérénité dans l'application !`;
}
