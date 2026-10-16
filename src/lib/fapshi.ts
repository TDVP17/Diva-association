// Fapshi payment gateway client. API reference: https://docs.fapshi.com
// Auth: `apiuser` / `apikey` headers on every request (not bearer tokens).

function cleanEnv(val: string | undefined): string {
  if (!val) return "";
  return val.trim().replace(/^["']|["']$/g, "");
}

export function getFapshiBaseUrl(): string {
  const envUrl = cleanEnv(process.env.FAPSHI_BASE_URL).replace(/\/+$/, "");
  if (envUrl) return envUrl;
  const apiKey = cleanEnv(process.env.FAPSHI_API_KEY);
  if (
    process.env.NODE_ENV === "production" ||
    (apiKey && !apiKey.toLowerCase().includes("test") && !apiKey.toLowerCase().includes("sandbox"))
  ) {
    return "https://live.fapshi.com";
  }
  return "https://sandbox.fapshi.com";
}

export function getFapshiApiUser(): string {
  return cleanEnv(process.env.FAPSHI_API_USER);
}

export function getFapshiApiKey(): string {
  return cleanEnv(process.env.FAPSHI_API_KEY);
}

export function getFapshiPayoutBaseUrl(): string {
  const envUrl = cleanEnv(process.env.FAPSHI_PAYOUT_BASE_URL).replace(/\/+$/, "");
  if (envUrl) return envUrl;
  return getFapshiBaseUrl();
}

export function getFapshiPayoutApiUser(): string {
  return cleanEnv(process.env.FAPSHI_PAYOUT_API_USER) || getFapshiApiUser();
}

export function getFapshiPayoutApiKey(): string {
  return cleanEnv(process.env.FAPSHI_PAYOUT_API_KEY) || getFapshiApiKey();
}

export type FapshiPaymentStatus = "CREATED" | "PENDING" | "SUCCESSFUL" | "COMPLETED" | "FAILED" | "EXPIRED";

export interface InitiateDirectPayParams {
  amount: number;
  /** Mobile Money / Orange Money number the USSD prompt is sent to, e.g. "677123456". */
  phone: string;
  medium?: "mobile money" | "orange money";
  name?: string;
  email?: string;
  userId?: string;
  externalId?: string;
  message?: string;
  redirectUrl?: string;
}

export interface InitiateDirectPayResult {
  message: string;
  transId: string;
  dateInitiated: string;
  link?: string;
}

export interface PaymentStatusResult {
  transId: string;
  status: FapshiPaymentStatus;
  medium: string;
  serviceName: string;
  transType: string;
  amount: number;
  revenue: number;
  payerName: string | null;
  email: string | null;
  redirectUrl: string | null;
  externalId: string | null;
  userId: string | null;
  /** Present mainly on payout failures per Fapshi's docs, but checked for collection failures too. */
  reason?: string | null;
  financialTransId: string | null;
  dateInitiated: string;
  dateConfirmed: string | null;
}

class FapshiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "FapshiError";
  }
}

function authHeaders(): Record<string, string> {
  return {
    apiuser: getFapshiApiUser(),
    apikey: getFapshiApiKey(),
    "Content-Type": "application/json",
  };
}

/** Cameroon mobile numbers Fapshi expects: 9 digits, no country code/leading zero (e.g. "677123456"). */
export function normalizeCameroonPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const trimmed = digits.startsWith("237") ? digits.slice(3) : digits;
  return /^[6-9]\d{8}$/.test(trimmed) ? trimmed : null;
}

/**
 * Triggers an immediate USSD payment prompt on the payer's own phone (no
 * redirect, no hosted checkout page) — the payer approves with their Mobile
 * Money/Orange Money PIN directly on their device. Replaces the old
 * hosted-link `/initiate-pay` flow so the phone number is always captured
 * explicitly in our own UI before anything is charged.
 */
export async function initiateDirectPayment(params: InitiateDirectPayParams): Promise<InitiateDirectPayResult> {
  if (params.amount < 100) {
    throw new FapshiError("Amount must be at least 100 XAF", 400);
  }
  const apiUser = getFapshiApiUser();
  const apiKey = getFapshiApiKey();
  if (!apiUser || !apiKey) {
    throw new FapshiError("Fapshi is not configured", 500);
  }

  const baseUrl = getFapshiBaseUrl();

  const directPayload = {
    amount: params.amount,
    phone: params.phone,
    medium: params.medium,
    name: params.name,
    email: params.email,
    userId: params.userId,
    externalId: params.externalId,
    message: params.message,
  };

  const res = await fetch(`${baseUrl}/direct-pay`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(directPayload),
  });

  const body = await res.json().catch(() => null);
  if (res.ok && body?.transId) {
    return body as InitiateDirectPayResult;
  }

  // If Direct Pay is not yet activated on Fapshi Live (HTTP 403 / activate-direct-pay error),
  // automatically fall back to Fapshi's hosted checkout (/initiate-pay) so payments work immediately!
  const isDirectPayDisabled =
    res.status === 403 &&
    (typeof body?.message === "string" &&
      (body.message.includes("activate-direct-pay") || body.message.includes("Forbidden request")));

  if (isDirectPayDisabled) {
    const fallbackAppUrl =
      params.redirectUrl ||
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXTAUTH_URL ||
      "https://www.divaasso.com";

    const initRes = await fetch(`${baseUrl}/initiate-pay`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        amount: params.amount,
        email: params.email,
        userId: params.userId,
        externalId: params.externalId,
        message: params.message,
        redirectUrl: fallbackAppUrl,
      }),
    });

    const initBody = await initRes.json().catch(() => null);
    if (initRes.ok && initBody?.link && initBody?.transId) {
      return {
        message: initBody.message ?? "Request successful",
        transId: initBody.transId,
        dateInitiated: initBody.dateInitiated ?? new Date().toISOString(),
        link: initBody.link,
      };
    }
  }

  throw new FapshiError(body?.message ?? "Fapshi payment request failed", res.status);
}

export interface PayoutParams {
  amount: number;
  /** Mobile Money / Orange Money number the refund is sent to. */
  phone: string;
  medium?: "mobile money" | "orange money";
  name?: string;
  externalId?: string;
  message?: string;
}

export interface PayoutResult {
  message: string;
  transId: string;
  dateInitiated: string;
}

export function isPayoutConfigured(): boolean {
  return Boolean(getFapshiPayoutApiUser() && getFapshiPayoutApiKey());
}

/**
 * Sends money out via Fapshi's dedicated payout-only service — used
 * exclusively for automated duplicate-payment refunds (see
 * src/lib/trigger-fapshi-refund.ts). Throws FapshiError(500) if the payout
 * service hasn't been configured yet, so callers can route straight to
 * manual review instead of silently failing.
 */
export async function initiatePayout(params: PayoutParams): Promise<PayoutResult> {
  if (!isPayoutConfigured()) {
    throw new FapshiError("Fapshi payout service is not configured", 500);
  }
  if (params.amount < 100) {
    throw new FapshiError("Amount must be at least 100 XAF", 400);
  }

  const payoutBaseUrl = getFapshiPayoutBaseUrl();
  const res = await fetch(`${payoutBaseUrl}/payout`, {
    method: "POST",
    headers: {
      apiuser: getFapshiPayoutApiUser(),
      apikey: getFapshiPayoutApiKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new FapshiError(body?.message ?? "Fapshi payout request failed", res.status);
  }
  return body as PayoutResult;
}

export async function getPaymentStatus(transId: string): Promise<PaymentStatusResult> {
  const baseUrl = getFapshiBaseUrl();
  const res = await fetch(`${baseUrl}/payment-status/${encodeURIComponent(transId)}`, {
    method: "GET",
    headers: authHeaders(),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new FapshiError(body?.message ?? "Fapshi payment-status request failed", res.status);
  }
  return body as PaymentStatusResult;
}

export { FapshiError };
