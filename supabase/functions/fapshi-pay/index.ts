import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  computeProviderFee,
  detectMobileMoneyProvider,
  FapshiError,
  fapshiMediumFor,
  type FapshiPaymentStatus,
  getAppBaseUrl,
  getPaymentStatus,
  initiateDirectPayment,
  initiateHostedPayment,
  initiatePayout,
  isPayoutConfigured,
  normalizeCameroonPhone,
  type PaymentStatusResult,
  verifyWebhookSecret,
} from "./fapshi.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-wh-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

// ---------------------------------------------------------------------------
// Utilitaires IDs, dates Cameroun (UTC+1) & formatage FCFA
// ---------------------------------------------------------------------------

/** Génère un identifiant compatible CUID (25 caractères alphanumériques minuscules). */
function createId(): string {
  const ts = Date.now().toString(36);
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let rand = "";
  for (const b of bytes) {
    rand += (b % 36).toString(36);
  }
  return `c${ts}${rand}`.slice(0, 25);
}

/**
 * Les colonnes Prisma `DateTime` sont stockées en `timestamp without time zone` (UTC).
 * PostgREST renvoie `"2026-11-08T00:00:00"` sans suffixe `Z` : on force l'interprétation UTC.
 */
function parseUtcDate(raw: string | Date): Date {
  if (raw instanceof Date) return raw;
  const hasTz = raw.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(raw);
  return new Date(hasTz ? raw : `${raw}Z`);
}

function formatXAF(amount: number): string {
  const rounded = Math.round(amount);
  const formatted = rounded
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${formatted} FCFA`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatSessionSummaryEdge(labels: string[], lang: "fr" | "en"): string {
  const unique = [...new Set(labels.filter(Boolean))];
  if (unique.length === 0) return "DIVA Asso";
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]}, ${unique[1]}`;
  return lang === "en" ? `${unique.length} tontines` : `${unique.length} cotisations`;
}

function renderReceiptBrandedEmailHtml(params: {
  title: string;
  bodyHtml: string;
  actionUrl: string;
  actionLabel: string;
  lang: "fr" | "en";
}): string {
  const baseUrl = getAppBaseUrl();
  const logoUrl = `${baseUrl}/icons/icon-512.png`;
  const primaryColor = "#003528";
  const rawUrl = params.actionUrl.trim() || "/dashboard";
  let targetUrl = rawUrl;

  if (rawUrl.startsWith("http")) {
    try {
      const parsed = new URL(rawUrl);
      const baseOrigin = new URL(baseUrl).origin;
      if (parsed.origin === baseOrigin) {
        targetUrl = `${baseUrl}/open?target=${encodeURIComponent(parsed.pathname + parsed.search)}`;
      }
    } catch {
      targetUrl = rawUrl;
    }
  } else {
    const cleanPath = rawUrl.startsWith("/") ? rawUrl : `/${rawUrl}`;
    targetUrl = `${baseUrl}/open?target=${encodeURIComponent(cleanPath)}`;
  }

  return `
    <!DOCTYPE html>
    <html lang="${params.lang}">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${escapeHtml(params.title)}</title>
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px 12px; -webkit-font-smoothing: antialiased;">
      <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 580px; margin: 0 auto; background-color: #ffffff; border-radius: 14px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 16px rgba(15, 23, 42, 0.04);">
        <tr>
          <td style="padding: 26px 24px 20px; text-align: center; background: linear-gradient(180deg, #f0fdf4 0%, #ffffff 100%); border-bottom: 1px solid #f1f5f9;">
            <a href="${baseUrl}" target="_blank" style="text-decoration: none; display: inline-block;">
              <img src="${logoUrl}" alt="DIVA Asso" width="60" height="60" style="display: block; margin: 0 auto 10px; border-radius: 14px; border: 1px solid #e2e8f0;" />
              <span style="display: block; font-size: 20px; font-weight: 800; color: #003528; letter-spacing: -0.5px;">DIVA Asso.</span>
            </a>
          </td>
        </tr>
        <tr>
          <td style="padding: 28px 28px 20px;">
            <h2 style="color: #0f172a; font-size: 18px; font-weight: 700; margin-top: 0; margin-bottom: 18px; line-height: 1.4;">${escapeHtml(params.title)}</h2>
            <div style="font-size: 15px; line-height: 1.6; color: #334155;">
              ${params.bodyHtml}
            </div>
            <div style="margin: 28px 0 10px 0; text-align: center;">
              <a href="${targetUrl}"
                 style="background-color: ${primaryColor}; color: #ffffff; padding: 13px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px; display: inline-block; box-shadow: 0 2px 4px rgba(0,53,40,0.15);">
                ${escapeHtml(params.actionLabel)}
              </a>
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding: 20px 24px 28px; background-color: #f8fafc; border-top: 1px solid #f1f5f9; text-align: center;">
            <p style="font-size: 12px; color: #64748b; margin: 0 0 6px 0;">
              <strong>DIVA Asso.</strong> — Plateforme sécurisée de gestion des tontines et cotisations
            </p>
            <p style="font-size: 11px; color: #94a3b8; margin: 0;">
              <a href="${baseUrl}" style="color: #003528; text-decoration: underline;">www.divaasso.com</a> • Bertoua, Cameroun
            </p>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `.trim();
}

function buildPaymentReceiptEmailHtml(
  lang: "fr" | "en",
  data: {
    recipientName: string;
    items: { beneficiaryName: string; sessionLabel?: string; amount?: number }[];
    paidByName?: string;
    sessionLabel: string;
    amount: number;
    transRef: string;
    receiptUrl: string;
    isPayerCopy?: boolean;
  },
): { subject: string; html: string } {
  const isEn = lang === "en";
  const subject = data.isPayerCopy
    ? isEn
      ? `Payment sent — ${data.sessionLabel}`
      : `Paiement envoyé — ${data.sessionLabel}`
    : isEn
      ? `Payment received — ${data.sessionLabel}`
      : `Paiement reçu — ${data.sessionLabel}`;

  const greeting = isEn
    ? `Hello ${escapeHtml(data.recipientName)},`
    : `Bonjour ${escapeHtml(data.recipientName)},`;
  const intro = isEn
    ? "🎉 Your contribution has been received successfully."
    : "🎉 Votre contribution a été reçue avec succès.";

  const distinctSessions = [...new Set(data.items.map((i) => i.sessionLabel).filter(Boolean))];
  const showSessionInline = distinctSessions.length > 1;
  const namesHtml =
    data.items.length === 1
      ? escapeHtml(data.items[0].beneficiaryName)
      : data.items
          .map(
            (item) =>
              `<div style="padding: 3px 0; line-height: 1.4; display: flex; justify-content: space-between; gap: 12px; text-align: left;"><span>• ${escapeHtml(item.beneficiaryName)}${
                showSessionInline && item.sessionLabel
                  ? ` <span style="font-weight: 400; color: #64748b; font-size: 12px;">(${escapeHtml(item.sessionLabel)})</span>`
                  : ""
              }</span>${
                item.amount !== undefined ? `<strong style="color: #003528; text-align: right; white-space: nowrap;">${formatXAF(item.amount)}</strong>` : ""
              }</div>`,
          )
          .join("");

  const forBase = isEn ? "Contributed for" : "Contribution pour";
  const forLabel = data.items.length > 1 ? `${forBase} (${data.items.length})` : forBase;
  const paidByLabel = isEn ? "Paid by" : "Payé par";
  const contributionLabel = "Contribution";
  const amountLabel = isEn ? "Amount" : "Montant";
  const txIdLabel = isEn ? "Transaction ID" : "ID de transaction";
  const closingLine = isEn
    ? "Thank you for your contribution to DIVA asso."
    : "Merci pour votre contribution chez DIVA asso.";
  const downloadLabel = isEn
    ? "Download Payment Receipt (PDF)"
    : "Télécharger le reçu (PDF)";

  const tdLabelStyle = "padding: 6px 12px 6px 0; color: #64748b; white-space: nowrap; vertical-align: top;";
  const tdValStyle = "padding: 6px 0; font-weight: 600; text-align: right; vertical-align: top;";
  const paidByRow = data.paidByName
    ? `<tr><td style="${tdLabelStyle}"><strong>${paidByLabel} :</strong></td><td style="${tdValStyle}">${escapeHtml(data.paidByName)}</td></tr>`
    : "";

  const bodyHtml = `
    <p style="margin-top: 0;">${greeting}</p>
    <p>${intro}</p>

    <table width="100%" style="margin: 18px 0; border-collapse: collapse; font-size: 14px;">
      <tr>
        <td style="${tdLabelStyle}"><strong>${forLabel} :</strong></td>
        <td style="${tdValStyle}">${namesHtml}</td>
      </tr>
      ${paidByRow}
      <tr>
        <td style="${tdLabelStyle}"><strong>${contributionLabel} :</strong></td>
        <td style="${tdValStyle}">${escapeHtml(data.sessionLabel)}</td>
      </tr>
      <tr>
        <td style="${tdLabelStyle}"><strong>${amountLabel} :</strong></td>
        <td style="padding: 6px 0; font-weight: 700; color: #003528; text-align: right; vertical-align: top; font-size: 16px;">${formatXAF(data.amount)}</td>
      </tr>
      <tr>
        <td style="${tdLabelStyle}"><strong>${txIdLabel} :</strong></td>
        <td style="padding: 6px 0; font-family: monospace; text-align: right; vertical-align: top; font-size: 13px; word-break: break-all;">${escapeHtml(data.transRef)}</td>
      </tr>
    </table>

    <p style="margin-bottom: 0;">${closingLine}</p>
  `;

  return {
    subject,
    html: renderReceiptBrandedEmailHtml({
      title: subject,
      bodyHtml,
      actionUrl: data.receiptUrl,
      actionLabel: downloadLabel,
      lang,
    }),
  };
}

async function sendReceiptEmailSafeEdge(options: {
  to: string | null | undefined;
  subject: string;
  html: string;
}): Promise<void> {
  if (!options.to) return;
  const apiKey = (Deno.env.get("RESEND_API_KEY") ?? "").trim().replace(/^["']|["']$/g, "");
  if (!apiKey) {
    console.warn("[fapshi-pay] RESEND_API_KEY not configured; skipping email receipt");
    return;
  }
  const from =
    Deno.env.get("RESEND_FROM") ||
    Deno.env.get("EMAIL_FROM") ||
    "DIVA Asso <contact@divaasso.com>";

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: options.to,
        subject: options.subject,
        html: options.html,
      }),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error("[fapshi-pay] Resend email error:", res.status, errBody);
    }
  } catch (err) {
    console.error("[fapshi-pay] Email dispatch failed:", err);
  }
}

type TontineType =
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

const TONTINE_TYPE_LABELS: Record<TontineType, string> = {
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

const CAMEROON_TIME_ZONE = "Africa/Douala";
const BIWEEKLY_REFERENCE_SUNDAY = Date.UTC(2024, 0, 7);
const QUARTERLY_MONTHS = [1, 4, 7, 10];

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

function getCameroonDateParts(date: Date): {
  year: number;
  month: number;
  day: number;
  weekday: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CAMEROON_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
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
  };
}

function toDueDateKey(date: Date): Date {
  const { year, month, day } = getCameroonDateParts(date);
  return new Date(Date.UTC(year, month - 1, day));
}

function isContributionDay(type: TontineType, date: Date): boolean {
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

function getNextDueDate(type: TontineType, from: Date): Date {
  const cursor = new Date(from);
  for (let i = 0; i < 120; i++) {
    if (isContributionDay(type, cursor)) {
      return toDueDateKey(cursor);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  throw new Error(`Could not determine next due date for ${type}`);
}

function getMostRecentDueDate(type: TontineType, from: Date): Date {
  const cursor = new Date(from);
  for (let i = 0; i < 120; i++) {
    if (isContributionDay(type, cursor)) {
      return toDueDateKey(cursor);
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  throw new Error(`Could not determine most recent due date for ${type}`);
}

function getPreviousDueDate(type: TontineType, dueDate: Date): Date {
  const cursor = new Date(dueDate);
  cursor.setUTCDate(cursor.getUTCDate() - 1);
  return getMostRecentDueDate(type, cursor);
}

function getCycleDateForRound(
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

function isSessionCycleFinished(params: {
  status: string;
  type: TontineType;
  startDate: Date | null;
  officialPositions: (number | null)[];
  now?: Date;
}): boolean {
  if (params.status === "CLOSED") return true;
  if (!params.startDate || params.officialPositions.length === 0) return false;
  const isDrawn = params.officialPositions.every((p) => p !== null && p > 0);
  const maxPos = Math.max(0, ...params.officialPositions.map((p) => p ?? 0));
  if (!isDrawn || maxPos <= 0) return false;

  const sessionEndDate = getCycleDateForRound(
    params.type,
    params.startDate,
    maxPos,
  );
  const dueDate = getNextDueDate(params.type, params.now ?? new Date());
  return dueDate > sessionEndDate;
}

function getSlotNextUnpaidDueDate(params: {
  type: TontineType;
  startDate: Date | null;
  maxPosition: number;
  paidDueDates: (Date | string)[];
}): { round: number | null; dueDate: Date | null; isAllPaid: boolean } {
  if (!params.startDate) {
    return {
      round: 1,
      dueDate: getNextDueDate(params.type, new Date()),
      isAllPaid: false,
    };
  }
  const maxRounds = params.maxPosition > 0 ? params.maxPosition : 1;
  const paidTimestamps = new Set(
    params.paidDueDates.map((d) => toDueDateKey(parseUtcDate(d)).getTime()),
  );

  for (let r = 1; r <= maxRounds; r++) {
    const rDueDate = getCycleDateForRound(params.type, params.startDate, r);
    if (!paidTimestamps.has(rDueDate.getTime())) {
      return { round: r, dueDate: rDueDate, isAllPaid: false };
    }
  }
  return { round: null, dueDate: null, isAllPaid: true };
}

// ---------------------------------------------------------------------------
// Accès Supabase Service Role & Authentification utilisateur
// ---------------------------------------------------------------------------

interface AppUser {
  id: string;
  email: string;
  name: string;
  role: "MEMBER" | "ADMIN" | "PRESIDENT";
  preferredLang: string | null;
  isBanned: boolean;
}

function getSupabaseAdmin(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function getAuthenticatedUser(
  req: Request,
  supabase: SupabaseClient,
): Promise<AppUser | null> {
  const authHeader = req.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;

  const email = data.user.email?.trim();
  if (email) {
    const { data: dbUser } = await supabase
      .from("users")
      .select("id, email, name, role, preferredLang, isBanned")
      .ilike("email", email)
      .maybeSingle<AppUser>();
    if (dbUser && !dbUser.isBanned) return dbUser;
  }

  const { data: byId } = await supabase
    .from("users")
    .select("id, email, name, role, preferredLang, isBanned")
    .eq("id", data.user.id)
    .maybeSingle<AppUser>();
  if (byId && !byId.isBanned) return byId;

  return null;
}

// ---------------------------------------------------------------------------
// Règles métier Tontine (échéance, cycle terminé, verrou round-robin)
// ---------------------------------------------------------------------------

interface TontineSessionRow {
  id: string;
  title: string | null;
  type: TontineType;
  amount: number | string;
  fee: number | string;
  status: string;
  startDate: string;
  isPaused: boolean;
}

interface SlotWithSession {
  id: string;
  membershipId: string;
  beneficiaryName: string;
  officialPosition: number | null;
  ballDrawn: number | null;
  membership: {
    id: string;
    userId: string;
    tontineSessionId: string;
    status: string;
    tontineSession: TontineSessionRow;
  };
}

async function loadSlotWithSession(
  supabase: SupabaseClient,
  membershipSlotId: string,
): Promise<SlotWithSession | null> {
  const { data } = await supabase
    .from("membership_slots")
    .select(
      `
      id,
      membershipId,
      beneficiaryName,
      officialPosition,
      ballDrawn,
      membership:memberships!inner (
        id,
        userId,
        tontineSessionId,
        status,
        tontineSession:tontine_sessions!inner (
          id,
          title,
          type,
          amount,
          fee,
          status,
          startDate,
          isPaused
        )
      )
    `,
    )
    .eq("id", membershipSlotId)
    .maybeSingle();

  return (data as unknown as SlotWithSession | null) ?? null;
}

async function loadApprovedSessionPositions(
  supabase: SupabaseClient,
  tontineSessionId: string,
): Promise<(number | null)[]> {
  const { data } = await supabase
    .from("membership_slots")
    .select("officialPosition, memberships!inner(tontineSessionId, status)")
    .eq("memberships.tontineSessionId", tontineSessionId)
    .eq("memberships.status", "APPROVED");

  return (data ?? []).map(
    (r: { officialPosition: number | null }) => r.officialPosition,
  );
}

async function resolveDueDateForSlot(
  supabase: SupabaseClient,
  membershipSlotId: string,
  session: TontineSessionRow,
  explicitDueDate?: string | null,
): Promise<Date> {
  if (explicitDueDate) {
    return toDueDateKey(parseUtcDate(explicitDueDate));
  }
  const startDate = session.startDate ? parseUtcDate(session.startDate) : null;
  if (!startDate) {
    return getNextDueDate(session.type, new Date());
  }

  const positions = await loadApprovedSessionPositions(supabase, session.id);
  const maxPos =
    Math.max(0, ...positions.map((p) => p ?? 0)) || positions.length || 1;

  const { data: paidRows } = await supabase
    .from("contributions")
    .select("dueDate")
    .eq("membershipSlotId", membershipSlotId)
    .eq("status", "PAID");

  const nextUnpaid = getSlotNextUnpaidDueDate({
    type: session.type,
    startDate,
    maxPosition: maxPos,
    paidDueDates: (paidRows ?? []).map((c: { dueDate: string }) => c.dueDate),
  });

  return nextUnpaid.dueDate ?? getNextDueDate(session.type, new Date());
}

async function assertCycleNotFinished(
  supabase: SupabaseClient,
  session: TontineSessionRow,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const positions = await loadApprovedSessionPositions(supabase, session.id);
  const startDate = session.startDate ? parseUtcDate(session.startDate) : null;
  if (
    isSessionCycleFinished({
      status: session.status,
      type: session.type,
      startDate,
      officialPositions: positions,
      now: new Date(),
    })
  ) {
    return {
      ok: false,
      status: 409,
      error:
        "Cette session de cotisation est terminée pour ce cycle. Les cotisations sont closes.",
    };
  }
  return { ok: true };
}

async function assertPriorCyclePaidOut(
  supabase: SupabaseClient,
  tontineSessionId: string,
  type: TontineType,
  dueDate: Date,
  startDate: Date,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const previousDueDate = getPreviousDueDate(type, dueDate);
  if (previousDueDate < startDate) {
    return { ok: true };
  }

  const { data: slotsWithPayouts } = await supabase
    .from("membership_slots")
    .select(
      "id, beneficiaryName, officialPosition, memberships!inner(tontineSessionId), payouts(id)",
    )
    .eq("memberships.tontineSessionId", tontineSessionId)
    .not("officialPosition", "is", null)
    .order("officialPosition", { ascending: true });

  const designatedSlot = (slotsWithPayouts ?? []).find(
    (s: { payouts?: { id: string }[] }) => !s.payouts || s.payouts.length === 0,
  ) as { id: string; beneficiaryName: string } | undefined;

  if (!designatedSlot) {
    return { ok: true };
  }

  const { data: previousCyclePayout } = await supabase
    .from("payouts")
    .select("id, releasedAt")
    .eq("tontineSessionId", tontineSessionId)
    .eq("dueDate", previousDueDate.toISOString())
    .maybeSingle<{ id: string; releasedAt: string | null }>();

  if (previousCyclePayout?.releasedAt) {
    return { ok: true };
  }

  return {
    ok: false,
    status: 409,
    error: `Les cotisations pour ce nouveau cycle ne peuvent pas débuter tant que la cagnotte du cycle précédent de ${designatedSlot.beneficiaryName} n'a pas été versée par l'administrateur.`,
  };
}

// ---------------------------------------------------------------------------
// Notifications IN_APP (déclenche Supabase Realtime immédiatement)
// ---------------------------------------------------------------------------

interface NotifRecipient {
  userId: string;
  message: string;
  messageKey?: string;
  messageVars?: Record<string, string>;
  actionUrl?: string;
}

async function insertInAppNotifications(
  supabase: SupabaseClient,
  params: {
    tontineSessionId?: string;
    type: string;
    recipients: NotifRecipient[];
  },
): Promise<void> {
  if (params.recipients.length === 0) return;

  const userIds = params.recipients.map((r) => r.userId);
  const { data: users } = await supabase
    .from("users")
    .select("id, name, preferredLang")
    .in("id", userIds);
  const userMap = new Map(
    (users ?? []).map(
      (u: { id: string; name: string; preferredLang: string | null }) => [
        u.id,
        u,
      ],
    ),
  );

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const rows: Record<string, unknown>[] = [];

  params.recipients.forEach((r, idx) => {
    const u = userMap.get(r.userId);
    const lang = u?.preferredLang === "en" ? "en" : "fr";
    const firstName = u?.name?.trim().split(/\s+/)[0] ?? "";
    const greeting = firstName
      ? lang === "en"
        ? `Hello, ${firstName} 👋`
        : `Salut, ${firstName} 👋`
      : "";
    const hasGreeting =
      r.message.startsWith("Salut") ||
      r.message.startsWith("Bonjour") ||
      r.message.startsWith("Hello") ||
      r.message.startsWith("Hi");
    const finalMessage =
      greeting && !hasGreeting ? `${greeting} ! ${r.message}` : r.message;
    const vars = {
      ...(r.messageVars ?? {}),
      ...(firstName ? { name: firstName } : {}),
    };

    // Ligne IN_APP immédiatement marquée SENT (déclenche le badge Realtime côté client)
    rows.push({
      id: createId(),
      tontineSessionId: params.tontineSessionId ?? null,
      userId: r.userId,
      channel: "IN_APP",
      type: params.type,
      message: finalMessage,
      messageKey: r.messageKey ?? null,
      messageVars: vars,
      actionUrl: r.actionUrl ?? null,
      status: "SENT",
      scheduledAt: nowIso,
      sentAt: nowIso,
      createdAt: nowIso,
    });

    // Mise en file PUSH (+ EMAIL sauf PAYMENT_SUCCESS qui envoie déjà le reçu PDF officiel)
    const scheduledAt = new Date(now + idx * 3 * 60 * 1000).toISOString();
    const channels =
      params.type === "PAYMENT_SUCCESS"
        ? (["PUSH"] as const)
        : (["PUSH", "EMAIL"] as const);
    for (const channel of channels) {
      rows.push({
        id: createId(),
        tontineSessionId: params.tontineSessionId ?? null,
        userId: r.userId,
        channel,
        type: params.type,
        message: finalMessage,
        messageKey: r.messageKey ?? null,
        messageVars: vars,
        actionUrl: r.actionUrl ?? null,
        status: "SCHEDULED",
        scheduledAt,
        createdAt: nowIso,
      });
    }
  });

  await supabase.from("notifications").insert(rows);
}

// ---------------------------------------------------------------------------
// 1 & 5 : Initiation paiement individuel + Paiement pour un proche + Quote
// ---------------------------------------------------------------------------

const SLOT_IN_FLIGHT_WINDOW_MS = 90 * 1000;
const BULK_OR_FINE_IN_FLIGHT_WINDOW_MS = 10 * 60 * 1000;
const MAX_SLOTS_PER_BULK_PAYMENT = 20;

async function handleSlotQuote(
  supabase: SupabaseClient,
  membershipSlotId: string,
  explicitDueDate?: string,
): Promise<Response> {
  const slot = await loadSlotWithSession(supabase, membershipSlotId);
  if (
    !slot ||
    slot.membership.status !== "APPROVED" ||
    (slot.membership.tontineSession.status !== "ACTIVE" &&
      slot.membership.tontineSession.status !== "DRAWING")
  ) {
    return jsonResponse(
      { error: "This slot isn't currently accepting contributions" },
      404,
    );
  }
  if (slot.membership.tontineSession.isPaused) {
    return jsonResponse(
      {
        error:
          "This cotisation is temporarily paused — payments will resume shortly",
      },
      409,
    );
  }
  if (slot.officialPosition === null || slot.ballDrawn === null) {
    return jsonResponse(
      {
        error:
          "Impossible de cotiser tant que l'ordre de bouffe (position) n'est pas établi",
      },
      409,
    );
  }

  const session = slot.membership.tontineSession;
  const dueDate = await resolveDueDateForSlot(
    supabase,
    membershipSlotId,
    session,
    explicitDueDate,
  );

  const cycleCheck = await assertCycleNotFinished(supabase, session);
  if (!cycleCheck.ok) {
    return jsonResponse({ error: cycleCheck.error }, cycleCheck.status);
  }

  const { data: existing } = await supabase
    .from("contributions")
    .select("id, status")
    .eq("membershipSlotId", membershipSlotId)
    .eq("dueDate", dueDate.toISOString())
    .maybeSingle<{ id: string; status: string }>();

  if (existing?.status === "PAID") {
    return jsonResponse(
      { error: "This slot is already paid for this cycle" },
      409,
    );
  }

  const amount = Number(session.amount);
  const fee = Number(session.fee);
  const baseTotal = amount + fee;
  const providerFee = computeProviderFee(baseTotal);

  return jsonResponse({
    amount,
    fee,
    fineAmount: 0,
    baseTotal,
    provider: "FAPSHI",
    providerFeeAmount: providerFee.providerFeeAmount,
    totalCharged: providerFee.totalCharged,
  });
}

async function initiateSlotPaymentCore(
  supabase: SupabaseClient,
  params: {
    membershipSlotId: string;
    phone: string;
    paidByUserId: string;
    requireSelfOwnership: boolean;
    useCheckout?: boolean;
    dueDate?: string;
  },
): Promise<Response> {
  const normalizedPhone = normalizeCameroonPhone(params.phone);
  if (!normalizedPhone) {
    return jsonResponse(
      { error: "Please enter a valid Mobile Money / Orange Money number" },
      400,
    );
  }

  const slot = await loadSlotWithSession(supabase, params.membershipSlotId);
  if (!slot) {
    return jsonResponse(
      { error: "This slot isn't currently accepting contributions" },
      404,
    );
  }
  if (
    params.requireSelfOwnership &&
    slot.membership.userId !== params.paidByUserId
  ) {
    await supabase.from("security_logs").insert({
      id: createId(),
      type: "unauthorized_payment_attempt",
      ip: null,
      userAgent: null,
      details: {
        userId: params.paidByUserId,
        targetSlotId: slot.id,
        targetOwnerId: slot.membership.userId,
      },
      createdAt: new Date().toISOString(),
    });
    return jsonResponse({ error: "You don't own this slot" }, 403);
  }
  if (
    slot.membership.status !== "APPROVED" ||
    (slot.membership.tontineSession.status !== "ACTIVE" &&
      slot.membership.tontineSession.status !== "DRAWING")
  ) {
    return jsonResponse(
      { error: "This slot isn't currently accepting contributions" },
      404,
    );
  }
  if (slot.membership.tontineSession.isPaused) {
    return jsonResponse(
      {
        error:
          "This cotisation is temporarily paused — payments will resume shortly",
      },
      409,
    );
  }
  if (slot.officialPosition === null || slot.ballDrawn === null) {
    return jsonResponse(
      {
        error:
          "Impossible de cotiser tant que l'ordre de bouffe (position) n'est pas établi",
      },
      409,
    );
  }

  const session = slot.membership.tontineSession;
  const dueDate = await resolveDueDateForSlot(
    supabase,
    params.membershipSlotId,
    session,
    params.dueDate,
  );

  const cycleCheck = await assertCycleNotFinished(supabase, session);
  if (!cycleCheck.ok) {
    return jsonResponse({ error: cycleCheck.error }, cycleCheck.status);
  }

  const roundLock = await assertPriorCyclePaidOut(
    supabase,
    session.id,
    session.type,
    dueDate,
    parseUtcDate(session.startDate),
  );
  if (!roundLock.ok) {
    return jsonResponse({ error: roundLock.error }, roundLock.status);
  }

  const amount = Number(session.amount);
  const fee = Number(session.fee);
  const baseTotal = amount + fee;
  const providerFee = computeProviderFee(baseTotal);

  const { data: existing } = await supabase
    .from("contributions")
    .select("id, status, updatedAt")
    .eq("membershipSlotId", params.membershipSlotId)
    .eq("dueDate", dueDate.toISOString())
    .maybeSingle<{ id: string; status: string; updatedAt: string }>();

  if (existing?.status === "PAID") {
    return jsonResponse(
      { error: "This slot is already paid for this cycle" },
      409,
    );
  }
  if (
    existing?.status === "PENDING" &&
    Date.now() - parseUtcDate(existing.updatedAt).getTime() <
      SLOT_IN_FLIGHT_WINDOW_MS
  ) {
    return jsonResponse(
      {
        error:
          "A payment is already in progress for this slot — please wait a moment before trying again",
      },
      409,
    );
  }

  const nowIso = new Date().toISOString();
  const contributionId = existing?.id ?? createId();
  const contribData = {
    amountPaid: amount,
    feePaid: fee,
    finePaid: 0,
    status: "PENDING",
    payerPhone: normalizedPhone,
    failureReason: null,
    paidByUserId: params.paidByUserId,
    paymentProvider: "FAPSHI",
    providerFeeAmount: providerFee.providerFeeAmount,
    providerShareAmount: providerFee.providerShareAmount,
    presidentFeeShareAmount: providerFee.presidentFeeShareAmount,
    updatedAt: nowIso,
  };

  if (existing) {
    const { error: updErr } = await supabase
      .from("contributions")
      .update(contribData)
      .eq("id", existing.id);
    if (updErr) {
      return jsonResponse({ error: "Could not claim contribution slot" }, 500);
    }
  } else {
    const { error: insErr } = await supabase.from("contributions").insert({
      id: contributionId,
      membershipSlotId: params.membershipSlotId,
      dueDate: dueDate.toISOString(),
      createdAt: nowIso,
      ...contribData,
    });
    if (insErr) {
      return jsonResponse({ error: "Could not create contribution row" }, 500);
    }
  }

  try {
    const detectedProvider = detectMobileMoneyProvider(normalizedPhone);
    const redirectUrl = `${getAppBaseUrl()}/sessions/${session.id}`;
    const fapshiMessage = `DIVA cotisation — ${slot.beneficiaryName} (${session.type})`;

    const result = params.useCheckout
      ? await initiateHostedPayment({
          amount: providerFee.totalCharged,
          userId: slot.membership.userId,
          externalId: contributionId,
          message: fapshiMessage,
          redirectUrl,
        })
      : await initiateDirectPayment({
          amount: providerFee.totalCharged,
          phone: normalizedPhone,
          userId: slot.membership.userId,
          externalId: contributionId,
          message: fapshiMessage,
          medium: detectedProvider
            ? fapshiMediumFor(detectedProvider)
            : undefined,
          redirectUrl,
        });

    const attemptIso = new Date().toISOString();
    await Promise.all([
      supabase
        .from("contributions")
        .update({ fapshiTxRef: result.transId, updatedAt: attemptIso })
        .eq("id", contributionId),
      supabase.from("payment_attempts").insert({
        id: createId(),
        transId: result.transId,
        contributionId,
        payerPhone: normalizedPhone,
        amount: providerFee.totalCharged,
        status: "PENDING",
        createdAt: attemptIso,
        updatedAt: attemptIso,
      }),
    ]);

    return jsonResponse({ transId: result.transId, link: result.link });
  } catch (err) {
    const reason =
      err instanceof FapshiError ? err.message : "Payment initiation failed";
    await supabase
      .from("contributions")
      .update({
        status: "FAILED",
        failureReason: reason,
        updatedAt: new Date().toISOString(),
      })
      .eq("id", contributionId);

    if (err instanceof FapshiError) {
      return jsonResponse({ error: err.message }, 502);
    }
    return jsonResponse({ error: "Payment initiation failed" }, 500);
  }
}

// ---------------------------------------------------------------------------
// 4 : Paiement groupé (Bulk Payment + Bulk Quote)
// ---------------------------------------------------------------------------

async function validateBulkSlots(
  supabase: SupabaseClient,
  userId: string,
  membershipSlotIds: string[],
  isRelative?: boolean,
): Promise<
  | {
      ok: true;
      slots: SlotWithSession[];
      isRelativePayment: boolean;
    }
  | { ok: false; status: number; error: string }
> {
  const uniqueIds = [...new Set(membershipSlotIds)].sort();
  if (uniqueIds.length === 0) {
    return {
      ok: false,
      status: 400,
      error: "Select at least one name to pay for",
    };
  }
  if (uniqueIds.length > MAX_SLOTS_PER_BULK_PAYMENT) {
    return {
      ok: false,
      status: 400,
      error: "Please select fewer names for one combined payment",
    };
  }

  const loaded = await Promise.all(
    uniqueIds.map((id) => loadSlotWithSession(supabase, id)),
  );
  if (loaded.some((s) => !s)) {
    return {
      ok: false,
      status: 404,
      error: "One or more selected names could not be found",
    };
  }
  const slots = loaded as SlotWithSession[];
  const firstOwnerId = slots[0].membership.userId;

  const roundLockCache = new Map<
    string,
    { ok: true } | { ok: false; status: number; error: string }
  >();

  for (const slot of slots) {
    if (isRelative) {
      if (slot.membership.userId !== firstOwnerId) {
        return {
          ok: false,
          status: 400,
          error: "All selected names must belong to the same member",
        };
      }
    } else if (slot.membership.userId !== userId) {
      await supabase.from("security_logs").insert({
        id: createId(),
        type: "unauthorized_bulk_payment_attempt",
        ip: null,
        userAgent: null,
        details: {
          userId,
          targetSlotId: slot.id,
          targetOwnerId: slot.membership.userId,
        },
        createdAt: new Date().toISOString(),
      });
      return {
        ok: false,
        status: 403,
        error: "You can only include your own names in a combined payment",
      };
    }

    const session = slot.membership.tontineSession;
    if (
      slot.membership.status !== "APPROVED" ||
      (session.status !== "ACTIVE" && session.status !== "DRAWING")
    ) {
      return {
        ok: false,
        status: 409,
        error: `${slot.beneficiaryName} isn't currently accepting contributions`,
      };
    }
    if (session.isPaused) {
      return {
        ok: false,
        status: 409,
        error: `${slot.beneficiaryName}'s cotisation is temporarily paused`,
      };
    }
    if (slot.officialPosition === null || slot.ballDrawn === null) {
      return {
        ok: false,
        status: 409,
        error: `Impossible de cotiser tant que l'ordre de bouffe n'est pas établi (${slot.beneficiaryName})`,
      };
    }

    const dueDate = await resolveDueDateForSlot(supabase, slot.id, session);
    const cacheKey = `${session.id}-${dueDate.getTime()}`;
    if (!roundLockCache.has(cacheKey)) {
      roundLockCache.set(
        cacheKey,
        await assertPriorCyclePaidOut(
          supabase,
          session.id,
          session.type,
          dueDate,
          parseUtcDate(session.startDate),
        ),
      );
    }
    const lockRes = roundLockCache.get(cacheKey)!;
    if (!lockRes.ok) {
      return {
        ok: false,
        status: lockRes.status,
        error: `${slot.beneficiaryName}: ${lockRes.error}`,
      };
    }
  }

  return {
    ok: true,
    slots,
    isRelativePayment: firstOwnerId !== userId,
  };
}

async function handleBulkQuote(
  supabase: SupabaseClient,
  userId: string,
  membershipSlotIds: string[],
  isRelative?: boolean,
): Promise<Response> {
  const validated = await validateBulkSlots(
    supabase,
    userId,
    membershipSlotIds,
    isRelative,
  );
  if (!validated.ok) {
    return jsonResponse({ error: validated.error }, validated.status);
  }

  const items = [];
  let baseTotal = 0;

  for (const slot of validated.slots) {
    const session = slot.membership.tontineSession;
    const dueDate = await resolveDueDateForSlot(supabase, slot.id, session);
    const { data: existing } = await supabase
      .from("contributions")
      .select("id, status")
      .eq("membershipSlotId", slot.id)
      .eq("dueDate", dueDate.toISOString())
      .maybeSingle<{ id: string; status: string }>();

    if (existing?.status === "PAID") {
      return jsonResponse(
        { error: `${slot.beneficiaryName} is already paid for this cycle` },
        409,
      );
    }

    const amount = Number(session.amount);
    const fee = Number(session.fee);
    const slotBase = amount + fee;
    baseTotal += slotBase;

    items.push({
      membershipSlotId: slot.id,
      beneficiaryName: slot.beneficiaryName,
      sessionLabel:
        session.title || TONTINE_TYPE_LABELS[session.type] || session.type,
      amount,
      fee,
      fineAmount: 0,
      baseTotal: slotBase,
    });
  }

  const combinedFee = computeProviderFee(baseTotal);
  return jsonResponse({
    items,
    baseTotal,
    provider: "FAPSHI",
    providerFeeAmount: combinedFee.providerFeeAmount,
    totalCharged: combinedFee.totalCharged,
  });
}

async function handleBulkInitiate(
  supabase: SupabaseClient,
  userId: string,
  membershipSlotIds: string[],
  phone: string,
  options?: { isRelative?: boolean; useCheckout?: boolean },
): Promise<Response> {
  const normalizedPhone = normalizeCameroonPhone(phone);
  if (!normalizedPhone) {
    return jsonResponse(
      { error: "Please enter a valid Mobile Money / Orange Money number" },
      400,
    );
  }

  const validated = await validateBulkSlots(
    supabase,
    userId,
    membershipSlotIds,
    options?.isRelative,
  );
  if (!validated.ok) {
    return jsonResponse({ error: validated.error }, validated.status);
  }

  const prepared: {
    slot: SlotWithSession;
    dueDate: Date;
    existingId?: string;
    amount: number;
    fee: number;
  }[] = [];
  let baseTotal = 0;

  for (const slot of validated.slots) {
    const session = slot.membership.tontineSession;
    const dueDate = await resolveDueDateForSlot(supabase, slot.id, session);
    const { data: existing } = await supabase
      .from("contributions")
      .select("id, status, updatedAt")
      .eq("membershipSlotId", slot.id)
      .eq("dueDate", dueDate.toISOString())
      .maybeSingle<{ id: string; status: string; updatedAt: string }>();

    if (existing?.status === "PAID") {
      return jsonResponse(
        { error: `${slot.beneficiaryName} is already paid for this cycle` },
        409,
      );
    }
    if (
      existing?.status === "PENDING" &&
      Date.now() - parseUtcDate(existing.updatedAt).getTime() <
        BULK_OR_FINE_IN_FLIGHT_WINDOW_MS
    ) {
      return jsonResponse(
        { error: `A payment is already in progress for ${slot.beneficiaryName}` },
        409,
      );
    }

    const amount = Number(session.amount);
    const fee = Number(session.fee);
    baseTotal += amount + fee;
    prepared.push({
      slot,
      dueDate,
      existingId: existing?.id,
      amount,
      fee,
    });
  }

  const combinedFee = computeProviderFee(baseTotal);
  const nowIso = new Date().toISOString();
  const bulkPaymentId = createId();

  const { error: bulkErr } = await supabase.from("bulk_payments").insert({
    id: bulkPaymentId,
    userId,
    payerPhone: normalizedPhone,
    amount: combinedFee.totalCharged,
    status: "PENDING",
    createdAt: nowIso,
    updatedAt: nowIso,
  });
  if (bulkErr) {
    return jsonResponse({ error: "Could not initialize bulk payment" }, 500);
  }

  for (const item of prepared) {
    const slotFee = computeProviderFee(item.amount + item.fee);
    const data = {
      amountPaid: item.amount,
      feePaid: item.fee,
      finePaid: 0,
      status: "PENDING",
      payerPhone: normalizedPhone,
      failureReason: null,
      bulkPaymentId,
      paidByUserId: validated.isRelativePayment ? userId : null,
      paymentProvider: "FAPSHI",
      providerFeeAmount: slotFee.providerFeeAmount,
      providerShareAmount: slotFee.providerShareAmount,
      presidentFeeShareAmount: slotFee.presidentFeeShareAmount,
      updatedAt: nowIso,
    };

    if (item.existingId) {
      await supabase
        .from("contributions")
        .update(data)
        .eq("id", item.existingId);
    } else {
      await supabase.from("contributions").insert({
        id: createId(),
        membershipSlotId: item.slot.id,
        dueDate: item.dueDate.toISOString(),
        createdAt: nowIso,
        ...data,
      });
    }
  }

  const names = validated.slots.map((s) => s.beneficiaryName);
  const namesLabel =
    names.length > 3 ? `${names.slice(0, 3).join(", ")}…` : names.join(", ");
  const redirectUrl = `${getAppBaseUrl()}/global-payment`;
  const fapshiMsg = `DIVA — paiement groupé pour ${names.length} nom(s) : ${namesLabel}`;

  try {
    const detectedProvider = detectMobileMoneyProvider(normalizedPhone);
    const result = options?.useCheckout
      ? await initiateHostedPayment({
          amount: combinedFee.totalCharged,
          userId,
          externalId: bulkPaymentId,
          message: fapshiMsg,
          redirectUrl,
        })
      : await initiateDirectPayment({
          amount: combinedFee.totalCharged,
          phone: normalizedPhone,
          userId,
          externalId: bulkPaymentId,
          message: fapshiMsg,
          medium: detectedProvider
            ? fapshiMediumFor(detectedProvider)
            : undefined,
          redirectUrl,
        });

    const attemptIso = new Date().toISOString();
    await Promise.all([
      supabase
        .from("bulk_payments")
        .update({ transId: result.transId, updatedAt: attemptIso })
        .eq("id", bulkPaymentId),
      supabase.from("payment_attempts").insert({
        id: createId(),
        transId: result.transId,
        bulkPaymentId,
        payerPhone: normalizedPhone,
        amount: combinedFee.totalCharged,
        status: "PENDING",
        createdAt: attemptIso,
        updatedAt: attemptIso,
      }),
    ]);

    return jsonResponse({ transId: result.transId, link: result.link });
  } catch (err) {
    const reason =
      err instanceof FapshiError ? err.message : "Payment initiation failed";
    const failIso = new Date().toISOString();
    await Promise.all([
      supabase
        .from("bulk_payments")
        .update({ status: "FAILED", failureReason: reason, updatedAt: failIso })
        .eq("id", bulkPaymentId),
      supabase
        .from("contributions")
        .update({ status: "FAILED", failureReason: reason, updatedAt: failIso })
        .eq("bulkPaymentId", bulkPaymentId),
    ]);

    if (err instanceof FapshiError) {
      return jsonResponse({ error: err.message }, 502);
    }
    return jsonResponse({ error: "Payment initiation failed" }, 500);
  }
}

// ---------------------------------------------------------------------------
// 6 : Paiement d'amende (Fine Initiate + Fine Quote)
// ---------------------------------------------------------------------------

interface FineWithOwner {
  id: string;
  membershipSlotId: string;
  amount: number | string;
  status: string;
  fapshiTxRef: string | null;
  updatedAt: string;
  membershipSlot: {
    id: string;
    beneficiaryName: string;
    membership: {
      id: string;
      userId: string;
      tontineSessionId: string;
      tontineSession: TontineSessionRow;
    };
  };
}

async function loadOwnedFine(
  supabase: SupabaseClient,
  fineId: string,
  userId: string,
): Promise<FineWithOwner | null> {
  const { data } = await supabase
    .from("fines")
    .select(
      `
      id,
      membershipSlotId,
      amount,
      status,
      fapshiTxRef,
      updatedAt,
      membershipSlot:membership_slots!inner (
        id,
        beneficiaryName,
        membership:memberships!inner (
          id,
          userId,
          tontineSessionId,
          tontineSession:tontine_sessions!inner (
            id,
            title,
            type,
            amount,
            fee,
            status,
            startDate,
            isPaused
          )
        )
      )
    `,
    )
    .eq("id", fineId)
    .maybeSingle();

  const fine = (data as unknown as FineWithOwner | null) ?? null;
  if (!fine || fine.membershipSlot.membership.userId !== userId) return null;
  return fine;
}

async function handleFineQuote(
  supabase: SupabaseClient,
  fineId: string,
  userId: string,
): Promise<Response> {
  const fine = await loadOwnedFine(supabase, fineId, userId);
  if (!fine) {
    return jsonResponse({ error: "Fine not found" }, 404);
  }
  if (fine.status === "PAID" || fine.status === "DEDUCTED") {
    return jsonResponse({ error: "This fine has already been settled" }, 409);
  }

  const baseTotal = Number(fine.amount);
  const providerFee = computeProviderFee(baseTotal);
  return jsonResponse({
    baseTotal,
    provider: "FAPSHI",
    providerFeeAmount: providerFee.providerFeeAmount,
    totalCharged: providerFee.totalCharged,
  });
}

async function handleFineInitiate(
  supabase: SupabaseClient,
  fineId: string,
  phone: string,
  userId: string,
): Promise<Response> {
  const normalizedPhone = normalizeCameroonPhone(phone);
  if (!normalizedPhone) {
    return jsonResponse(
      { error: "Please enter a valid Mobile Money / Orange Money number" },
      400,
    );
  }

  const fine = await loadOwnedFine(supabase, fineId, userId);
  if (!fine) {
    return jsonResponse({ error: "Fine not found" }, 404);
  }
  if (fine.status === "PAID" || fine.status === "DEDUCTED") {
    return jsonResponse({ error: "This fine has already been settled" }, 409);
  }
  if (
    (fine.status === "PENDING" || fine.status === "UNPAID") &&
    fine.fapshiTxRef &&
    Date.now() - parseUtcDate(fine.updatedAt).getTime() <
      BULK_OR_FINE_IN_FLIGHT_WINDOW_MS
  ) {
    return jsonResponse(
      {
        error:
          "A payment is already in progress for this fine — please wait a moment before trying again",
      },
      409,
    );
  }

  const baseTotal = Number(fine.amount);
  const providerFee = computeProviderFee(baseTotal);
  const claimIso = new Date().toISOString();

  await supabase
    .from("fines")
    .update({
      payerPhone: normalizedPhone,
      failureReason: null,
      updatedAt: claimIso,
    })
    .eq("id", fine.id);

  try {
    const detectedProvider = detectMobileMoneyProvider(normalizedPhone);
    const result = await initiateDirectPayment({
      amount: providerFee.totalCharged,
      phone: normalizedPhone,
      userId,
      externalId: fine.id,
      message: `DIVA late-payment fine — ${fine.membershipSlot.beneficiaryName}`,
      medium: detectedProvider
        ? fapshiMediumFor(detectedProvider)
        : undefined,
    });

    const attemptIso = new Date().toISOString();
    await Promise.all([
      supabase
        .from("fines")
        .update({ fapshiTxRef: result.transId, updatedAt: attemptIso })
        .eq("id", fine.id),
      supabase.from("payment_attempts").insert({
        id: createId(),
        transId: result.transId,
        fineId: fine.id,
        payerPhone: normalizedPhone,
        amount: providerFee.totalCharged,
        status: "PENDING",
        createdAt: attemptIso,
        updatedAt: attemptIso,
      }),
    ]);

    return jsonResponse({ transId: result.transId, link: result.link });
  } catch (err) {
    const reason =
      err instanceof FapshiError ? err.message : "Payment initiation failed";
    await supabase
      .from("fines")
      .update({ failureReason: reason, updatedAt: new Date().toISOString() })
      .eq("id", fine.id);

    if (err instanceof FapshiError) {
      return jsonResponse({ error: err.message }, 502);
    }
    return jsonResponse({ error: "Payment initiation failed" }, 500);
  }
}

// ---------------------------------------------------------------------------
// 2 & 3 : Vérification Statut & Webhook Fapshi (Règlement atomique + Realtime)
// ---------------------------------------------------------------------------

interface PaymentAttemptRow {
  id: string;
  transId: string;
  contributionId: string | null;
  fineId: string | null;
  bulkPaymentId: string | null;
  payerPhone: string;
  amount: number | string;
  status: string;
  refundAttempts: number;
}

interface ProcessedTransaction {
  status: FapshiPaymentStatus;
  alreadyProcessed?: boolean;
  duplicate?: boolean;
  failureReason?: string | null;
}

async function flagDuplicateAndRefund(
  supabase: SupabaseClient,
  attempt: PaymentAttemptRow,
  slotLabel: string,
): Promise<void> {
  const refundReason = `Remboursement automatique : Paiement en double détecté (problème réseau) pour ${slotLabel}`;
  const nowIso = new Date().toISOString();

  await supabase
    .from("payment_attempts")
    .update({
      status: "DUPLICATE_PAID",
      refundReason,
      nextRefundAttemptAt: nowIso,
      updatedAt: nowIso,
    })
    .eq("id", attempt.id);

  if (!isPayoutConfigured()) {
    await escalateDuplicateToManualReview(
      supabase,
      attempt,
      "Fapshi payout service is not configured",
      slotLabel,
      attempt.refundAttempts,
    );
    return;
  }

  await supabase
    .from("payment_attempts")
    .update({ status: "REFUND_INITIATED", updatedAt: new Date().toISOString() })
    .eq("id", attempt.id);

  try {
    const payout = await initiatePayout({
      amount: Number(attempt.amount),
      phone: attempt.payerPhone,
      externalId: `refund-${attempt.id}`,
      message: refundReason,
    });

    await supabase
      .from("payment_attempts")
      .update({
        status: "REFUNDED",
        refundTransId: payout.transId,
        refundedAt: new Date().toISOString(),
        lastRefundError: null,
        updatedAt: new Date().toISOString(),
      })
      .eq("id", attempt.id);
  } catch (err) {
    const attempts = (attempt.refundAttempts ?? 0) + 1;
    const errMsg = err instanceof Error ? err.message : "Refund failed";
    if (attempts >= 3) {
      await escalateDuplicateToManualReview(
        supabase,
        attempt,
        errMsg,
        slotLabel,
        attempts,
      );
    } else {
      const backoffMs = 5 * 2 ** (attempts - 1) * 60_000;
      await supabase
        .from("payment_attempts")
        .update({
          status: "DUPLICATE_PAID",
          refundAttempts: attempts,
          nextRefundAttemptAt: new Date(Date.now() + backoffMs).toISOString(),
          lastRefundError: errMsg,
          updatedAt: new Date().toISOString(),
        })
        .eq("id", attempt.id);
    }
  }
}

async function escalateDuplicateToManualReview(
  supabase: SupabaseClient,
  attempt: PaymentAttemptRow,
  reason: string,
  slotLabel: string,
  attempts: number,
): Promise<void> {
  const nowIso = new Date().toISOString();
  await supabase
    .from("payment_attempts")
    .update({
      status: "REFUND_FAILED_MANUAL_REVIEW",
      refundAttempts: attempts,
      lastRefundError: reason,
      nextRefundAttemptAt: null,
      updatedAt: nowIso,
    })
    .eq("id", attempt.id);

  const { data: admins } = await supabase
    .from("users")
    .select("id")
    .in("role", ["ADMIN", "PRESIDENT"]);

  if (admins && admins.length > 0) {
    const amountLabel = formatXAF(Number(attempt.amount));
    await insertInAppNotifications(supabase, {
      type: "PAYMENT_REFUND_ESCALATED",
      recipients: admins.map((a: { id: string }) => ({
        userId: a.id,
        message: `Le remboursement automatique a échoué pour un double paiement de ${amountLabel} sur « ${slotLabel} ». Veuillez rembourser manuellement.`,
        messageKey: "paymentRefundEscalatedNotifMessage",
        messageVars: { amount: amountLabel, slot: slotLabel },
        actionUrl: "/admin/payment-issues",
      })),
    });
  }
}

interface SettledContributionSummary {
  id: string;
  dueDate: string;
  sessionId: string;
  sessionLabel: string;
  owner: {
    id: string;
    name: string;
    email: string;
    preferredLang: string | null;
  };
  beneficiaryName: string;
  totalPaid: number;
  fapshiTxRef: string | null;
  paidByUserId: string | null;
  receiptKey: string;
}

async function checkAndTriggerMilestone100Percent(
  supabase: SupabaseClient,
  sessionId: string,
  sessionLabel: string,
  dueDate: string,
): Promise<void> {
  // Si 100% des parts approuvées ont cotisé pour ce cycle, alerte PAYOUT_TURN au bénéficiaire désigné
  try {
    const { data: allApprovedSlots } = await supabase
      .from("membership_slots")
      .select(
        "id, officialPosition, ballDrawn, memberships!inner(tontineSessionId, status, userId), payouts(id)",
      )
      .eq("memberships.tontineSessionId", sessionId)
      .eq("memberships.status", "APPROVED");

    const approvedList = (allApprovedSlots ?? []) as unknown as {
      id: string;
      officialPosition: number | null;
      ballDrawn: number | null;
      memberships: { userId: string };
      payouts?: { id: string }[];
    }[];

    if (approvedList.length > 0) {
      const { count: paidCount } = await supabase
        .from("contributions")
        .select("id", { count: "exact", head: true })
        .in(
          "membershipSlotId",
          approvedList.map((s) => s.id),
        )
        .eq("dueDate", dueDate)
        .eq("status", "PAID");

      if ((paidCount ?? 0) >= approvedList.length) {
        const designated = approvedList
          .filter(
            (s) =>
              s.officialPosition !== null &&
              s.ballDrawn !== null &&
              (!s.payouts || s.payouts.length === 0),
          )
          .sort(
            (a, b) => (a.officialPosition ?? 0) - (b.officialPosition ?? 0),
          )[0];

        if (designated) {
          const sinceIso = new Date(
            Date.now() - 24 * 60 * 60 * 1000,
          ).toISOString();
          const { data: recentAlert } = await supabase
            .from("notifications")
            .select("id")
            .eq("userId", designated.memberships.userId)
            .eq("tontineSessionId", sessionId)
            .eq("type", "PAYOUT_TURN")
            .gte("createdAt", sinceIso)
            .limit(1);

          if (!recentAlert || recentAlert.length === 0) {
            await insertInAppNotifications(supabase, {
              tontineSessionId: sessionId,
              type: "PAYOUT_TURN",
              recipients: [
                {
                  userId: designated.memberships.userId,
                  message: `C'est à votre tour de bouffer la cagnotte de ${sessionLabel} ! 🎉 Tous les membres ont cotisé : veuillez fournir votre numéro Mobile/Orange Money pour recevoir votre virement.`,
                  messageKey: "payoutTurnNotifMessage",
                  messageVars: { cotisation: sessionLabel },
                  actionUrl: `/sessions/${sessionId}`,
                },
              ],
            });
          }
        }
      }
    }
  } catch (err) {
    console.error("[fapshi-pay] 100% milestone check error:", err);
  }
}

async function sendSingleSettlementNotificationsAndEmail(
  supabase: SupabaseClient,
  summary: SettledContributionSummary,
  transRef: string,
): Promise<void> {
  const { owner, sessionId, sessionLabel, totalPaid, beneficiaryName, receiptKey } = summary;
  const ownerLang: "fr" | "en" = owner.preferredLang === "en" ? "en" : "fr";
  const receiptUrl = `${getAppBaseUrl()}/api/files/${receiptKey}`;
  const isRelative = Boolean(summary.paidByUserId && summary.paidByUserId !== owner.id);

  let payer: { id: string; name: string; email: string; preferredLang: string | null } | null = null;
  if (isRelative && summary.paidByUserId) {
    const { data: payerRow } = await supabase
      .from("users")
      .select("id, name, email, preferredLang")
      .eq("id", summary.paidByUserId)
      .maybeSingle<{ id: string; name: string; email: string; preferredLang: string | null }>();
    payer = payerRow ?? null;
  }

  // 1. Notification in-app au titulaire (montant net sans 3,1%)
  await insertInAppNotifications(supabase, {
    tontineSessionId: sessionId,
    type: "PAYMENT_SUCCESS",
    recipients: [
      {
        userId: owner.id,
        message:
          ownerLang === "en"
            ? `Your payment of ${formatXAF(totalPaid)} for ${sessionLabel} was received. Thank you!`
            : `Votre cotisation de ${formatXAF(totalPaid)} pour ${sessionLabel} a bien été reçue. Merci !`,
        messageKey: "paymentSuccessNotifMessage",
        messageVars: { amount: formatXAF(totalPaid), session: sessionLabel },
        actionUrl: `/sessions/${sessionId}`,
      },
    ],
  });

  // 2. Email reçu officiel au titulaire (sans frais 3,1%)
  const ownerEmail = buildPaymentReceiptEmailHtml(ownerLang, {
    recipientName: owner.name,
    items: [{ beneficiaryName, sessionLabel }],
    paidByName: payer?.name,
    sessionLabel,
    amount: totalPaid,
    transRef,
    receiptUrl,
  });
  await sendReceiptEmailSafeEdge({
    to: owner.email,
    subject: ownerEmail.subject,
    html: ownerEmail.html,
  });

  // 3. Notification + Email au proche payeur s'il est distinct du titulaire
  if (isRelative && payer) {
    const payerLang: "fr" | "en" = payer.preferredLang === "en" ? "en" : "fr";
    const beneficiaryLabel = `${owner.name} (${beneficiaryName})`;
    await insertInAppNotifications(supabase, {
      tontineSessionId: sessionId,
      type: "PAYMENT_SUCCESS",
      recipients: [
        {
          userId: payer.id,
          message:
            payerLang === "en"
              ? `Your contribution of ${formatXAF(totalPaid)} for ${beneficiaryLabel} in ${sessionLabel} was successful! Receipt is available.`
              : `Votre cotisation de ${formatXAF(totalPaid)} pour ${beneficiaryLabel} dans ${sessionLabel} a été validée avec succès ! Votre reçu est disponible.`,
          messageKey: "relativePaymentSuccessNotif",
          messageVars: {
            amount: formatXAF(totalPaid),
            beneficiary: beneficiaryLabel,
            session: sessionLabel,
          },
          actionUrl: "/history",
        },
      ],
    });

    const payerEmail = buildPaymentReceiptEmailHtml(payerLang, {
      recipientName: payer.name,
      items: [{ beneficiaryName: beneficiaryLabel, sessionLabel }],
      paidByName: payer.name,
      sessionLabel,
      amount: totalPaid,
      transRef,
      receiptUrl,
      isPayerCopy: true,
    });
    await sendReceiptEmailSafeEdge({
      to: payer.email,
      subject: payerEmail.subject,
      html: payerEmail.html,
    });
  }
}

async function finalizeContributionSettlement(
  supabase: SupabaseClient,
  contributionId: string,
  paidAt: Date,
  options?: { skipNotificationsAndEmail?: boolean },
): Promise<SettledContributionSummary | null> {
  const { data: contrib } = await supabase
    .from("contributions")
    .select(
      `
      id,
      membershipSlotId,
      dueDate,
      amountPaid,
      feePaid,
      finePaid,
      fapshiTxRef,
      paidByUserId,
      membershipSlot:membership_slots!inner (
        id,
        beneficiaryName,
        membership:memberships!inner (
          id,
          userId,
          tontineSessionId,
          user:users!inner ( id, name, email, preferredLang ),
          tontineSession:tontine_sessions!inner ( id, title, type )
        )
      )
    `,
    )
    .eq("id", contributionId)
    .maybeSingle();

  if (!contrib) return null;

  const typed = contrib as unknown as {
    id: string;
    membershipSlotId: string;
    dueDate: string;
    amountPaid: number | string;
    feePaid: number | string;
    finePaid: number | string;
    fapshiTxRef: string | null;
    paidByUserId: string | null;
    membershipSlot: {
      id: string;
      beneficiaryName: string;
      membership: {
        id: string;
        userId: string;
        tontineSessionId: string;
        user: {
          id: string;
          name: string;
          email: string;
          preferredLang: string | null;
        };
        tontineSession: { id: string; title: string | null; type: TontineType };
      };
    };
  };

  const owner = typed.membershipSlot.membership.user;
  const tontineSession = typed.membershipSlot.membership.tontineSession;
  const sessionId = typed.membershipSlot.membership.tontineSessionId;
  const sessionLabel =
    tontineSession.title ||
    TONTINE_TYPE_LABELS[tontineSession.type] ||
    tontineSession.type;

  const receiptKey = `receipts/${owner.id}/${typed.id}.pdf`;
  const paidIso = paidAt.toISOString();

  await supabase
    .from("contributions")
    .update({
      status: "PAID",
      paidAt: paidIso,
      receiptPdfUrl: receiptKey,
      updatedAt: new Date().toISOString(),
    })
    .eq("id", typed.id);

  if (Number(typed.finePaid) > 0) {
    await supabase
      .from("fines")
      .update({ status: "PAID", updatedAt: new Date().toISOString() })
      .eq("membershipSlotId", typed.membershipSlotId)
      .eq("dueDate", typed.dueDate)
      .eq("status", "UNPAID");
  }

  // Montant net cotisé uniquement (strictement sans les frais opérateur de 3,1%)
  const totalPaid =
    Number(typed.amountPaid) +
    Number(typed.feePaid) +
    Number(typed.finePaid);

  const summary: SettledContributionSummary = {
    id: typed.id,
    dueDate: typed.dueDate,
    sessionId,
    sessionLabel,
    owner,
    beneficiaryName: typed.membershipSlot.beneficiaryName,
    totalPaid,
    fapshiTxRef: typed.fapshiTxRef,
    paidByUserId: typed.paidByUserId,
    receiptKey,
  };

  if (options?.skipNotificationsAndEmail) {
    return summary;
  }

  await sendSingleSettlementNotificationsAndEmail(
    supabase,
    summary,
    typed.fapshiTxRef || typed.id,
  );
  await checkAndTriggerMilestone100Percent(
    supabase,
    sessionId,
    sessionLabel,
    typed.dueDate,
  );

  return summary;
}

async function settleOrFlagContribution(
  supabase: SupabaseClient,
  attempt: PaymentAttemptRow,
  verified: PaymentStatusResult,
): Promise<ProcessedTransaction> {
  const transId = attempt.transId;
  const paidAt = verified.dateConfirmed
    ? parseUtcDate(verified.dateConfirmed)
    : new Date();
  const nowIso = new Date().toISOString();

  // Réclamation atomique PostgreSQL : `WHERE id = ... AND status <> 'PAID'`
  const { data: claimed } = await supabase
    .from("contributions")
    .update({
      status: "PAID",
      paidAt: paidAt.toISOString(),
      fapshiTxRef: transId,
      updatedAt: nowIso,
    })
    .eq("id", attempt.contributionId!)
    .neq("status", "PAID")
    .select("id");

  if (!claimed || claimed.length === 0) {
    const { data: fresh } = await supabase
      .from("contributions")
      .select("id, status, fapshiTxRef, membershipSlotId")
      .eq("id", attempt.contributionId!)
      .maybeSingle<{
        id: string;
        status: string;
        fapshiTxRef: string | null;
        membershipSlotId: string;
      }>();

    if (!fresh) return { status: "SUCCESSFUL" };
    if (fresh.fapshiTxRef === transId) {
      await supabase
        .from("payment_attempts")
        .update({ status: "SUCCESSFUL", updatedAt: nowIso })
        .eq("id", attempt.id)
        .not("status", "in", '("REFUNDED","REFUND_INITIATED")');
      return { status: "SUCCESSFUL", alreadyProcessed: true };
    }

    const { data: slotRow } = await supabase
      .from("membership_slots")
      .select("beneficiaryName")
      .eq("id", fresh.membershipSlotId)
      .maybeSingle<{ beneficiaryName: string }>();

    await flagDuplicateAndRefund(
      supabase,
      attempt,
      slotRow?.beneficiaryName ?? "—",
    );
    return { status: "SUCCESSFUL", duplicate: true };
  }

  await finalizeContributionSettlement(supabase, attempt.contributionId!, paidAt);
  await supabase
    .from("payment_attempts")
    .update({ status: "SUCCESSFUL", updatedAt: new Date().toISOString() })
    .eq("id", attempt.id);

  return { status: "SUCCESSFUL" };
}

async function settleOrFlagFine(
  supabase: SupabaseClient,
  attempt: PaymentAttemptRow,
): Promise<ProcessedTransaction> {
  const transId = attempt.transId;
  const nowIso = new Date().toISOString();

  const { data: claimed } = await supabase
    .from("fines")
    .update({
      status: "PAID",
      fapshiTxRef: transId,
      updatedAt: nowIso,
    })
    .eq("id", attempt.fineId!)
    .not("status", "in", '("PAID","DEDUCTED")')
    .select("id");

  if (!claimed || claimed.length === 0) {
    const { data: fresh } = await supabase
      .from("fines")
      .select("id, status, fapshiTxRef, membershipSlotId")
      .eq("id", attempt.fineId!)
      .maybeSingle<{
        id: string;
        status: string;
        fapshiTxRef: string | null;
        membershipSlotId: string;
      }>();

    if (!fresh) return { status: "SUCCESSFUL" };
    if (fresh.fapshiTxRef === transId) {
      await supabase
        .from("payment_attempts")
        .update({ status: "SUCCESSFUL", updatedAt: nowIso })
        .eq("id", attempt.id)
        .not("status", "in", '("REFUNDED","REFUND_INITIATED")');
      return { status: "SUCCESSFUL", alreadyProcessed: true };
    }

    const { data: slotRow } = await supabase
      .from("membership_slots")
      .select("beneficiaryName")
      .eq("id", fresh.membershipSlotId)
      .maybeSingle<{ beneficiaryName: string }>();

    await flagDuplicateAndRefund(
      supabase,
      attempt,
      slotRow?.beneficiaryName ?? "—",
    );
    return { status: "SUCCESSFUL", duplicate: true };
  }

  const { data: fineRow } = await supabase
    .from("fines")
    .select(
      `
      id,
      amount,
      membershipSlot:membership_slots!inner (
        membership:memberships!inner (
          userId,
          tontineSessionId,
          tontineSession:tontine_sessions!inner ( id, title, type )
        )
      )
    `,
    )
    .eq("id", attempt.fineId!)
    .maybeSingle();

  if (fineRow) {
    const typed = fineRow as unknown as {
      amount: number | string;
      membershipSlot: {
        membership: {
          userId: string;
          tontineSessionId: string;
          tontineSession: { id: string; title: string | null; type: TontineType };
        };
      };
    };
    const m = typed.membershipSlot.membership;
    const sessionLabel =
      m.tontineSession.title ||
      TONTINE_TYPE_LABELS[m.tontineSession.type] ||
      m.tontineSession.type;
    const amountLabel = formatXAF(Number(typed.amount));

    await insertInAppNotifications(supabase, {
      tontineSessionId: m.tontineSessionId,
      type: "PAYMENT_SUCCESS",
      recipients: [
        {
          userId: m.userId,
          message: `Votre amende de ${amountLabel} pour ${sessionLabel} a bien été réglée.`,
          messageKey: "paymentSuccessNotifMessage",
          messageVars: { amount: amountLabel, session: sessionLabel },
          actionUrl: "/fines",
        },
      ],
    });
  }

  await supabase
    .from("payment_attempts")
    .update({ status: "SUCCESSFUL", updatedAt: new Date().toISOString() })
    .eq("id", attempt.id);

  return { status: "SUCCESSFUL" };
}

async function settleBulkPayment(
  supabase: SupabaseClient,
  attempt: PaymentAttemptRow,
  verified: PaymentStatusResult,
): Promise<ProcessedTransaction> {
  const transId = attempt.transId;
  const paidAt = verified.dateConfirmed
    ? parseUtcDate(verified.dateConfirmed)
    : new Date();
  const nowIso = new Date().toISOString();

  const { data: claimedBulk } = await supabase
    .from("bulk_payments")
    .update({ status: "SUCCESSFUL", updatedAt: nowIso })
    .eq("id", attempt.bulkPaymentId!)
    .neq("status", "SUCCESSFUL")
    .select("id");

  if (!claimedBulk || claimedBulk.length === 0) {
    await supabase
      .from("payment_attempts")
      .update({ status: "SUCCESSFUL", updatedAt: nowIso })
      .eq("id", attempt.id)
      .not("status", "in", '("REFUNDED","REFUND_INITIATED")');
    return { status: "SUCCESSFUL", alreadyProcessed: true };
  }

  const { data: contributions } = await supabase
    .from("contributions")
    .select("id, status")
    .eq("bulkPaymentId", attempt.bulkPaymentId!)
    .order("createdAt", { ascending: true });

  const settledItems: SettledContributionSummary[] = [];

  for (const c of (contributions ?? []) as { id: string; status: string }[]) {
    if (c.status === "PAID") continue;
    const { data: won } = await supabase
      .from("contributions")
      .update({
        status: "PAID",
        paidAt: paidAt.toISOString(),
        fapshiTxRef: `${transId}-${c.id}`,
        updatedAt: nowIso,
      })
      .eq("id", c.id)
      .neq("status", "PAID")
      .select("id");

    if (won && won.length > 0) {
      const summary = await finalizeContributionSettlement(
        supabase,
        c.id,
        paidAt,
        { skipNotificationsAndEmail: true },
      );
      if (summary) {
        settledItems.push(summary);
      }
    }
  }

  if (settledItems.length > 0) {
    // Vérification du palier 100% une seule fois par (sessionId, dueDate)
    const checkedMilestones = new Set<string>();
    for (const item of settledItems) {
      const key = `${item.sessionId}::${item.dueDate}`;
      if (!checkedMilestones.has(key)) {
        checkedMilestones.add(key);
        await checkAndTriggerMilestone100Percent(
          supabase,
          item.sessionId,
          item.sessionLabel,
          item.dueDate,
        );
      }
    }

    if (settledItems.length === 1) {
      await sendSingleSettlementNotificationsAndEmail(
        supabase,
        settledItems[0],
        transId,
      );
    } else {
      const relativePayerIds = [
        ...new Set(
          settledItems
            .filter((i) => i.paidByUserId && i.paidByUserId !== i.owner.id)
            .map((i) => i.paidByUserId!),
        ),
      ];
      const payerMap = new Map<
        string,
        { id: string; name: string; email: string; preferredLang: string | null }
      >();
      if (relativePayerIds.length > 0) {
        const { data: payerRows } = await supabase
          .from("users")
          .select("id, name, email, preferredLang")
          .in("id", relativePayerIds);
        for (const row of (payerRows ?? []) as {
          id: string;
          name: string;
          email: string;
          preferredLang: string | null;
        }[]) {
          payerMap.set(row.id, row);
        }
      }

      // 1. UN seul email consolidé + UNE notification par propriétaire de compte
      const byOwner = new Map<string, SettledContributionSummary[]>();
      for (const item of settledItems) {
        const list = byOwner.get(item.owner.id) ?? [];
        list.push(item);
        byOwner.set(item.owner.id, list);
      }

      for (const [ownerId, ownerItems] of byOwner.entries()) {
        const owner = ownerItems[0].owner;
        const ownerLang: "fr" | "en" = owner.preferredLang === "en" ? "en" : "fr";
        const ownerNetTotal = ownerItems.reduce((sum, i) => sum + i.totalPaid, 0);
        const distinctSessions = [
          ...new Set(ownerItems.map((i) => i.sessionLabel).filter(Boolean)),
        ];
        const distinctSessionIds = [...new Set(ownerItems.map((i) => i.sessionId))];
        const sessionSummary = formatSessionSummaryEdge(
          distinctSessions,
          ownerLang,
        );
        const relativeNamesForOwner = [
          ...new Set(
            ownerItems
              .filter((i) => i.paidByUserId && i.paidByUserId !== ownerId)
              .map((i) => payerMap.get(i.paidByUserId!)?.name)
              .filter((n): n is string => Boolean(n)),
          ),
        ];
        const paidByName =
          relativeNamesForOwner.length > 0
            ? relativeNamesForOwner.join(", ")
            : undefined;
        const receiptUrl =
          ownerItems.length === 1
            ? `${getAppBaseUrl()}/api/files/${ownerItems[0].receiptKey}`
            : `${getAppBaseUrl()}/api/files/receipts/${owner.id}/bulk-${attempt.bulkPaymentId}-owner.pdf`;

        const ownerEmail = buildPaymentReceiptEmailHtml(ownerLang, {
          recipientName: owner.name,
          items: ownerItems.map((i) => ({
            beneficiaryName: i.beneficiaryName,
            sessionLabel: i.sessionLabel,
            amount: i.totalPaid,
          })),
          paidByName,
          sessionLabel: sessionSummary,
          amount: ownerNetTotal,
          transRef: transId,
          receiptUrl,
        });
        await sendReceiptEmailSafeEdge({
          to: owner.email,
          subject: ownerEmail.subject,
          html: ownerEmail.html,
        });

        const singleSessionId =
          distinctSessionIds.length === 1 ? distinctSessionIds[0] : undefined;
        const namesInline = ownerItems.map((i) => i.beneficiaryName).join(", ");
        await insertInAppNotifications(supabase, {
          ...(singleSessionId ? { tontineSessionId: singleSessionId } : {}),
          type: "PAYMENT_SUCCESS",
          recipients: [
            {
              userId: owner.id,
              message:
                ownerLang === "en"
                  ? `Your payment of ${formatXAF(ownerNetTotal)} for ${ownerItems.length} names (${namesInline}) was received. Thank you!`
                  : `Votre paiement de ${formatXAF(ownerNetTotal)} pour ${ownerItems.length} noms (${namesInline}) a été reçu. Merci ! ✅🎉`,
              actionUrl: singleSessionId
                ? `/sessions/${singleSessionId}`
                : "/history",
            },
          ],
        });
      }

      // 2. UN seul email consolidé + UNE notification par proche payeur distinct
      const byRelativePayer = new Map<string, SettledContributionSummary[]>();
      for (const item of settledItems) {
        if (item.paidByUserId && item.paidByUserId !== item.owner.id) {
          const list = byRelativePayer.get(item.paidByUserId) ?? [];
          list.push(item);
          byRelativePayer.set(item.paidByUserId, list);
        }
      }

      for (const [payerId, payerItems] of byRelativePayer.entries()) {
        const payer = payerMap.get(payerId);
        if (!payer) continue;
        const payerLang: "fr" | "en" = payer.preferredLang === "en" ? "en" : "fr";
        const payerNetTotal = payerItems.reduce((sum, i) => sum + i.totalPaid, 0);
        const distinctOwnerIds = [...new Set(payerItems.map((i) => i.owner.id))];
        const showOwnerInline = distinctOwnerIds.length > 1;
        const distinctSessions = [
          ...new Set(payerItems.map((i) => i.sessionLabel).filter(Boolean)),
        ];
        const sessionSummary = formatSessionSummaryEdge(
          distinctSessions,
          payerLang,
        );
        const receiptUrl =
          payerItems.length === 1
            ? `${getAppBaseUrl()}/api/files/${payerItems[0].receiptKey}`
            : `${getAppBaseUrl()}/api/files/receipts/${payer.id}/bulk-${attempt.bulkPaymentId}-payer.pdf`;

        const payerEmail = buildPaymentReceiptEmailHtml(payerLang, {
          recipientName: payer.name,
          items: payerItems.map((i) => ({
            beneficiaryName: showOwnerInline
              ? `${i.owner.name} — ${i.beneficiaryName}`
              : i.beneficiaryName,
            sessionLabel: i.sessionLabel,
            amount: i.totalPaid,
          })),
          paidByName: payer.name,
          sessionLabel: sessionSummary,
          amount: payerNetTotal,
          transRef: transId,
          receiptUrl,
          isPayerCopy: true,
        });
        await sendReceiptEmailSafeEdge({
          to: payer.email,
          subject: payerEmail.subject,
          html: payerEmail.html,
        });

        const namesInline = payerItems.map((i) => i.beneficiaryName).join(", ");
        await insertInAppNotifications(supabase, {
          type: "PAYMENT_SUCCESS",
          recipients: [
            {
              userId: payer.id,
              message:
                payerLang === "en"
                  ? `Your contribution of ${formatXAF(payerNetTotal)} for ${payerItems.length} names (${namesInline}) was successful! Your receipt is available.`
                  : `Votre cotisation de ${formatXAF(payerNetTotal)} pour ${payerItems.length} noms (${namesInline}) a été validée avec succès ! Votre reçu est disponible.`,
              actionUrl: "/history",
            },
          ],
        });
      }
    }
  }

  await supabase
    .from("payment_attempts")
    .update({ status: "SUCCESSFUL", updatedAt: new Date().toISOString() })
    .eq("id", attempt.id);

  return { status: "SUCCESSFUL" };
}

async function handleFailedOrExpired(
  supabase: SupabaseClient,
  transId: string,
  verified: PaymentStatusResult,
): Promise<ProcessedTransaction> {
  const failureReason = verified.reason ?? null;
  const nowIso = new Date().toISOString();

  await supabase
    .from("payment_attempts")
    .update({
      status: verified.status === "FAILED" ? "FAILED" : "EXPIRED",
      updatedAt: nowIso,
    })
    .eq("transId", transId)
    .eq("status", "PENDING");

  // 1. Cas paiement groupé (BulkPayment)
  const { data: bulk } = await supabase
    .from("bulk_payments")
    .select("id, userId, amount, status")
    .eq("transId", transId)
    .maybeSingle<{
      id: string;
      userId: string;
      amount: number | string;
      status: string;
    }>();

  if (bulk && bulk.status !== "SUCCESSFUL" && bulk.status !== "FAILED") {
    await supabase
      .from("bulk_payments")
      .update({ status: "FAILED", failureReason, updatedAt: nowIso })
      .eq("id", bulk.id);

    const { data: failedContribs } = await supabase
      .from("contributions")
      .select("id, amountPaid, feePaid, finePaid")
      .eq("bulkPaymentId", bulk.id)
      .not("status", "in", '("PAID","FAILED")');

    if (failedContribs && failedContribs.length > 0) {
      await supabase
        .from("contributions")
        .update({ status: "FAILED", failureReason, updatedAt: nowIso })
        .in(
          "id",
          failedContribs.map((c: { id: string }) => c.id),
        );

      const netAmount = (failedContribs as { amountPaid?: number | string; feePaid?: number | string; finePaid?: number | string }[]).reduce(
        (sum, c) => sum + Number(c.amountPaid || 0) + Number(c.feePaid || 0) + Number(c.finePaid || 0),
        0,
      );
      // Montant net de cotisation uniquement (sans les 3,1% de Fapshi)
      const amountLabel = formatXAF(netAmount > 0 ? netAmount : Math.round(Number(bulk.amount) / 1.031));
      await insertInAppNotifications(supabase, {
        type: "PAYMENT_FAILED",
        recipients: [
          {
            userId: bulk.userId,
            message: `Votre paiement groupé de ${amountLabel} pour ${failedContribs.length} nom(s) n'a pas abouti. Veuillez réessayer.`,
            messageKey: "bulkPaymentFailedNotifMessage",
            messageVars: {
              amount: amountLabel,
              count: String(failedContribs.length),
            },
            actionUrl: "/sessions",
          },
        ],
      });
    }
  }

  // 2. Cas cotisation individuelle
  const { data: contrib } = await supabase
    .from("contributions")
    .select(
      `
      id,
      status,
      amountPaid,
      feePaid,
      finePaid,
      paidByUserId,
      membershipSlot:membership_slots!inner (
        membership:memberships!inner (
          userId,
          tontineSessionId,
          tontineSession:tontine_sessions!inner ( id, title, type )
        )
      )
    `,
    )
    .eq("fapshiTxRef", transId)
    .maybeSingle();

  if (contrib) {
    const typed = contrib as unknown as {
      id: string;
      status: string;
      amountPaid: number | string;
      feePaid: number | string;
      finePaid: number | string;
      paidByUserId: string | null;
      membershipSlot: {
        membership: {
          userId: string;
          tontineSessionId: string;
          tontineSession: { id: string; title: string | null; type: TontineType };
        };
      };
    };
    if (typed.status !== "PAID" && typed.status !== "FAILED") {
      await supabase
        .from("contributions")
        .update({ status: "FAILED", failureReason, updatedAt: nowIso })
        .eq("id", typed.id);

      const m = typed.membershipSlot.membership;
      const sessionLabel =
        m.tontineSession.title ||
        TONTINE_TYPE_LABELS[m.tontineSession.type] ||
        m.tontineSession.type;
      const amountLabel = formatXAF(
        Number(typed.amountPaid) + Number(typed.feePaid) + Number(typed.finePaid),
      );

      await insertInAppNotifications(supabase, {
        tontineSessionId: m.tontineSessionId,
        type: "PAYMENT_FAILED",
        recipients: [
          {
            userId: m.userId,
            message: `Votre paiement de ${amountLabel} pour ${sessionLabel} n'a pas abouti. Veuillez réessayer.`,
            messageKey: "paymentFailedNotifMessage",
            messageVars: { amount: amountLabel, session: sessionLabel },
            actionUrl: `/sessions/${m.tontineSessionId}`,
          },
          ...(typed.paidByUserId && typed.paidByUserId !== m.userId
            ? [
                {
                  userId: typed.paidByUserId,
                  message: `Votre tentative de cotisation de ${amountLabel} pour ${sessionLabel} n'a pas abouti. Veuillez réessayer.`,
                  messageKey: "paymentFailedNotifMessage",
                  messageVars: { amount: amountLabel, session: sessionLabel },
                  actionUrl: "/contribute-for-relative",
                },
              ]
            : []),
        ],
      });
    }
  }

  // 3. Cas amende
  const { data: fine } = await supabase
    .from("fines")
    .select(
      `
      id,
      status,
      amount,
      membershipSlot:membership_slots!inner (
        membership:memberships!inner (
          userId,
          tontineSessionId,
          tontineSession:tontine_sessions!inner ( id, title, type )
        )
      )
    `,
    )
    .eq("fapshiTxRef", transId)
    .maybeSingle();

  if (fine) {
    const typed = fine as unknown as {
      id: string;
      status: string;
      amount: number | string;
      membershipSlot: {
        membership: {
          userId: string;
          tontineSessionId: string;
          tontineSession: { id: string; title: string | null; type: TontineType };
        };
      };
    };
    if (
      typed.status !== "PAID" &&
      typed.status !== "DEDUCTED" &&
      typed.status !== "FAILED"
    ) {
      await supabase
        .from("fines")
        .update({ status: "FAILED", failureReason, updatedAt: nowIso })
        .eq("id", typed.id);

      const m = typed.membershipSlot.membership;
      const sessionLabel =
        m.tontineSession.title ||
        TONTINE_TYPE_LABELS[m.tontineSession.type] ||
        m.tontineSession.type;
      const amountLabel = formatXAF(Number(typed.amount));

      await insertInAppNotifications(supabase, {
        tontineSessionId: m.tontineSessionId,
        type: "PAYMENT_FAILED",
        recipients: [
          {
            userId: m.userId,
            message: `Votre paiement d'amende de ${amountLabel} pour ${sessionLabel} n'a pas abouti. Veuillez réessayer.`,
            messageKey: "paymentFailedNotifMessage",
            messageVars: { amount: amountLabel, session: sessionLabel },
            actionUrl: "/fines",
          },
        ],
      });
    }
  }

  return { status: verified.status, failureReason };
}

async function processFapshiTransaction(
  supabase: SupabaseClient,
  transId: string,
): Promise<ProcessedTransaction> {
  const verified = await getPaymentStatus(transId);

  const isSuccess =
    verified.status === "SUCCESSFUL" || verified.status === "COMPLETED";
  if (isSuccess) {
    const { data: attempt } = await supabase
      .from("payment_attempts")
      .select(
        "id, transId, contributionId, fineId, bulkPaymentId, payerPhone, amount, status, refundAttempts",
      )
      .eq("transId", transId)
      .maybeSingle<PaymentAttemptRow>();

    if (attempt?.contributionId) {
      return await settleOrFlagContribution(supabase, attempt, verified);
    }
    if (attempt?.fineId) {
      return await settleOrFlagFine(supabase, attempt);
    }
    if (attempt?.bulkPaymentId) {
      return await settleBulkPayment(supabase, attempt, verified);
    }

    // Repli legacy par fapshiTxRef si aucune ligne payment_attempts n'existe
    const { data: legacyContrib } = await supabase
      .from("contributions")
      .select("id, status")
      .eq("fapshiTxRef", transId)
      .maybeSingle<{ id: string; status: string }>();

    if (legacyContrib) {
      if (legacyContrib.status === "PAID") {
        return { status: "SUCCESSFUL", alreadyProcessed: true };
      }
      const paidAt = verified.dateConfirmed
        ? parseUtcDate(verified.dateConfirmed)
        : new Date();
      await finalizeContributionSettlement(supabase, legacyContrib.id, paidAt);
      return { status: "SUCCESSFUL" };
    }

    return { status: "SUCCESSFUL" };
  }

  if (verified.status === "FAILED" || verified.status === "EXPIRED") {
    return await handleFailedOrExpired(supabase, transId, verified);
  }

  return { status: verified.status };
}

// ---------------------------------------------------------------------------
// Point d'entrée HTTP Deno.serve (`supabase/functions/fapshi-pay`)
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = getSupabaseAdmin();
    const url = new URL(req.url);
    const subPath = url.pathname
      .replace(/^\/?(?:functions\/v1\/)?fapshi-pay\/?/, "")
      .replace(/\/+$/, "");

    // 1. GET /status?transId=... (ou GET ?transId=...)
    if (req.method === "GET") {
      if (subPath === "fine-quote") {
        const user = await getAuthenticatedUser(req, supabase);
        if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
        const fineId = url.searchParams.get("fineId")?.trim();
        if (!fineId) return jsonResponse({ error: "Missing fineId" }, 400);
        return await handleFineQuote(supabase, fineId, user.id);
      }

      const transId = url.searchParams.get("transId")?.trim();
      if (!transId) {
        return jsonResponse({ error: "Missing transId" }, 400);
      }
      const result = await processFapshiTransaction(supabase, transId);
      return jsonResponse(result);
    }

    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const body = (await req.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const webhookHeader = req.headers.get("x-wh-secret");
    const action =
      subPath ||
      (typeof body.action === "string" ? body.action.trim() : "") ||
      (webhookHeader ? "webhook" : "");

    // 2. Webhook Fapshi (`POST /webhook` ou tout POST signé `x-wh-secret`)
    if (action === "webhook") {
      if (!verifyWebhookSecret(webhookHeader)) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }
      const transId =
        typeof body.transId === "string" ? body.transId.trim() : "";
      if (!transId) {
        return jsonResponse({ error: "Missing transId" }, 400);
      }
      const result = await processFapshiTransaction(supabase, transId);
      return jsonResponse({ ok: true, ...result });
    }

    // 3. Vérification de statut via POST (`action: "status"`)
    if (action === "status") {
      const transId =
        typeof body.transId === "string" ? body.transId.trim() : "";
      if (!transId) {
        return jsonResponse({ error: "Missing transId" }, 400);
      }
      const result = await processFapshiTransaction(supabase, transId);
      return jsonResponse(result);
    }

    // 4. Devis simple (`action: "quote"` / `/quote` — accessible avant/sans session)
    if (action === "quote") {
      const membershipSlotId =
        typeof body.membershipSlotId === "string"
          ? body.membershipSlotId.trim()
          : "";
      if (!membershipSlotId) {
        return jsonResponse({ error: "Invalid request body" }, 400);
      }
      const dueDate =
        typeof body.dueDate === "string" ? body.dueDate : undefined;
      return await handleSlotQuote(supabase, membershipSlotId, dueDate);
    }

    // Toutes les actions suivantes exigent un utilisateur authentifié non banni
    const user = await getAuthenticatedUser(req, supabase);
    if (!user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    // Vérification du Bouton Panique (verrouillage d'urgence de la plateforme)
    const { data: appSetting } = await supabase
      .from("app_settings")
      .select("is_locked")
      .eq("id", "singleton")
      .maybeSingle();

    if (appSetting?.is_locked) {
      return jsonResponse(
        {
          error:
            "L'application est temporairement verrouillée par l'administrateur. Aucun paiement ne peut être effectué pour le moment.",
        },
        423,
      );
    }

    switch (action) {
      // 5. Paiement individuel (membre propriétaire de sa part)
      case "initiate": {
        const membershipSlotId =
          typeof body.membershipSlotId === "string"
            ? body.membershipSlotId.trim()
            : "";
        const phone = typeof body.phone === "string" ? body.phone.trim() : "";
        if (!membershipSlotId || !phone) {
          return jsonResponse({ error: "Invalid request body" }, 400);
        }
        return await initiateSlotPaymentCore(supabase, {
          membershipSlotId,
          phone,
          paidByUserId: user.id,
          requireSelfOwnership: true,
          useCheckout: Boolean(body.useCheckout),
          dueDate: typeof body.dueDate === "string" ? body.dueDate : undefined,
        });
      }

      // 6. Paiement pour un proche (`/relative` ou `/pay-slot`)
      case "relative":
      case "pay-slot": {
        const membershipSlotId =
          typeof body.membershipSlotId === "string"
            ? body.membershipSlotId.trim()
            : "";
        const phone = typeof body.phone === "string" ? body.phone.trim() : "";
        if (!membershipSlotId || !phone) {
          return jsonResponse({ error: "Invalid request body" }, 400);
        }
        const res = await initiateSlotPaymentCore(supabase, {
          membershipSlotId,
          phone,
          paidByUserId: user.id,
          requireSelfOwnership: false,
          useCheckout: Boolean(body.useCheckout),
          dueDate: typeof body.dueDate === "string" ? body.dueDate : undefined,
        });
        if (res.ok) {
          await supabase.from("audit_logs").insert({
            id: createId(),
            actorId: user.id,
            actorRole: user.role,
            action: "relative_payment_initiated",
            targetType: "MembershipSlot",
            targetId: membershipSlotId,
            ipAddress:
              req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
            userAgent: req.headers.get("user-agent") ?? null,
            status: "SUCCESS",
            createdAt: new Date().toISOString(),
          });
        }
        return res;
      }

      // 7. Paiement groupé multi-noms (`action: "bulk"`)
      case "bulk": {
        const rawIds = Array.isArray(body.membershipSlotIds)
          ? body.membershipSlotIds.filter(
              (x): x is string => typeof x === "string" && x.trim().length > 0,
            )
          : [];
        const phone = typeof body.phone === "string" ? body.phone.trim() : "";
        if (rawIds.length === 0 || !phone) {
          return jsonResponse({ error: "Invalid request body" }, 400);
        }
        return await handleBulkInitiate(supabase, user.id, rawIds, phone, {
          isRelative: Boolean(body.isRelative),
          useCheckout: Boolean(body.useCheckout),
        });
      }

      // 8. Devis paiement groupé (`action: "bulk-quote"`)
      case "bulk-quote": {
        const rawIds = Array.isArray(body.membershipSlotIds)
          ? body.membershipSlotIds.filter(
              (x): x is string => typeof x === "string" && x.trim().length > 0,
            )
          : [];
        if (rawIds.length === 0) {
          return jsonResponse({ error: "Invalid request body" }, 400);
        }
        return await handleBulkQuote(
          supabase,
          user.id,
          rawIds,
          Boolean(body.isRelative),
        );
      }

      // 9. Paiement d'amende (`action: "fine"`)
      case "fine": {
        const fineId =
          typeof body.fineId === "string" ? body.fineId.trim() : "";
        const phone = typeof body.phone === "string" ? body.phone.trim() : "";
        if (!fineId || !phone) {
          return jsonResponse({ error: "Invalid request body" }, 400);
        }
        return await handleFineInitiate(supabase, fineId, phone, user.id);
      }

      // 10. Devis amende (`action: "fine-quote"`)
      case "fine-quote": {
        const fineId =
          typeof body.fineId === "string" ? body.fineId.trim() : "";
        if (!fineId) {
          return jsonResponse({ error: "Invalid request body" }, 400);
        }
        return await handleFineQuote(supabase, fineId, user.id);
      }

      default:
        return jsonResponse(
          { error: `Unknown action "${action || "(empty)"}"` },
          400,
        );
    }
  } catch (err) {
    console.error("[fapshi-pay] unhandled error:", err);
    if (err instanceof FapshiError) {
      return jsonResponse({ error: err.message }, err.status || 502);
    }
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});

