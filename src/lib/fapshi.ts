// Fapshi payment gateway client. API reference: https://docs.fapshi.com
// Auth: `apiuser` / `apikey` headers on every request (not bearer tokens).

const FAPSHI_BASE_URL = process.env.FAPSHI_BASE_URL ?? "https://sandbox.fapshi.com";
const FAPSHI_API_USER = process.env.FAPSHI_API_USER ?? "";
const FAPSHI_API_KEY = process.env.FAPSHI_API_KEY ?? "";

// A payout call permanently disables COLLECTIONS on whichever Fapshi service
// makes it (per Fapshi's own docs), so refunds must run through a second,
// payout-only service with its own credentials — never the collection
// service above. Left unconfigured until that second service exists.
const FAPSHI_PAYOUT_BASE_URL = process.env.FAPSHI_PAYOUT_BASE_URL ?? FAPSHI_BASE_URL;
const FAPSHI_PAYOUT_API_USER = process.env.FAPSHI_PAYOUT_API_USER ?? "";
const FAPSHI_PAYOUT_API_KEY = process.env.FAPSHI_PAYOUT_API_KEY ?? "";

export type FapshiPaymentStatus = "CREATED" | "PENDING" | "SUCCESSFUL" | "FAILED" | "EXPIRED";

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
}

export interface InitiateDirectPayResult {
  message: string;
  transId: string;
  dateInitiated: string;
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
    apiuser: FAPSHI_API_USER,
    apikey: FAPSHI_API_KEY,
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
  if (!FAPSHI_API_USER || !FAPSHI_API_KEY) {
    throw new FapshiError("Fapshi is not configured", 500);
  }

  const res = await fetch(`${FAPSHI_BASE_URL}/direct-pay`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(params),
  });

  const body = await res.json();
  if (!res.ok) {
    throw new FapshiError(body?.message ?? "Fapshi direct-pay request failed", res.status);
  }
  return body as InitiateDirectPayResult;
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
  return Boolean(FAPSHI_PAYOUT_API_USER && FAPSHI_PAYOUT_API_KEY);
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

  const res = await fetch(`${FAPSHI_PAYOUT_BASE_URL}/payout`, {
    method: "POST",
    headers: {
      apiuser: FAPSHI_PAYOUT_API_USER,
      apikey: FAPSHI_PAYOUT_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });

  const body = await res.json();
  if (!res.ok) {
    throw new FapshiError(body?.message ?? "Fapshi payout request failed", res.status);
  }
  return body as PayoutResult;
}

export async function getPaymentStatus(transId: string): Promise<PaymentStatusResult> {
  const res = await fetch(`${FAPSHI_BASE_URL}/payment-status/${encodeURIComponent(transId)}`, {
    method: "GET",
    headers: authHeaders(),
  });

  const body = await res.json();
  if (!res.ok) {
    throw new FapshiError(body?.message ?? "Fapshi payment-status request failed", res.status);
  }
  return body as PaymentStatusResult;
}

export { FapshiError };
