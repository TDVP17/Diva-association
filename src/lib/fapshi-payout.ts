// Separate Fapshi *service* dedicated purely to disbursements — Fapshi's
// platform rule is "a service with payouts enabled can no longer collect
// payments," so this deliberately uses its own API user/key, distinct from
// src/lib/fapshi.ts's collection service.

function cleanEnv(val: string | undefined): string {
  if (!val) return "";
  return val.trim().replace(/^["']|["']$/g, "");
}

function getPayoutBaseUrl(): string {
  const envUrl = cleanEnv(process.env.FAPSHI_PAYOUT_BASE_URL || process.env.FAPSHI_BASE_URL).replace(/\/+$/, "");
  if (envUrl) return envUrl;
  return "https://live.fapshi.com";
}

function getPayoutApiUser(): string {
  return cleanEnv(process.env.FAPSHI_PAYOUT_API_USER || process.env.FAPSHI_API_USER);
}

function getPayoutApiKey(): string {
  return cleanEnv(process.env.FAPSHI_PAYOUT_API_KEY || process.env.FAPSHI_API_KEY);
}

export function isPayoutConfigured(): boolean {
  return Boolean(getPayoutApiUser() && getPayoutApiKey());
}

export interface PayoutParams {
  amount: number;
  phone: string;
  medium?: "mobile money" | "orange money";
  name?: string;
  userId?: string;
  externalId?: string;
  message?: string;
}

export interface PayoutResult {
  message: string;
  transId: string;
  dateInitiated: string;
}

export interface PayoutStatusResult {
  transId: string;
  status: "CREATED" | "PENDING" | "SUCCESSFUL" | "COMPLETED" | "FAILED" | "EXPIRED";
  amount: number;
  phone?: string;
  reason?: string | null;
  dateInitiated: string;
  dateConfirmed?: string | null;
}

class FapshiPayoutError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "FapshiPayoutError";
  }
}

function authHeaders(): Record<string, string> {
  return {
    apiuser: getPayoutApiUser(),
    apikey: getPayoutApiKey(),
    "Content-Type": "application/json",
  };
}

export async function sendPayout(params: PayoutParams): Promise<PayoutResult> {
  if (!isPayoutConfigured()) {
    throw new FapshiPayoutError(
      "Le service de reversement Fapshi (Disbursement) n'est pas configuré. Veuillez définir FAPSHI_PAYOUT_API_USER et FAPSHI_PAYOUT_API_KEY.",
      500,
    );
  }
  if (params.amount < 100) {
    throw new FapshiPayoutError("Le montant minimum pour un versement est de 100 FCFA", 400);
  }

  const payoutBaseUrl = getPayoutBaseUrl();
  const res = await fetch(`${payoutBaseUrl}/payout`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(params),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const errorMsg =
      body?.message ||
      (res.status === 401
        ? "Identifiants Fapshi Disbursement non autorisés"
        : res.status === 400
          ? "Paramètres de versement invalides (solde insuffisant ou numéro erroné)"
          : "Fapshi payout request failed");
    throw new FapshiPayoutError(errorMsg, res.status);
  }
  return body as PayoutResult;
}

export async function getPayoutStatus(transId: string): Promise<PayoutStatusResult> {
  if (!isPayoutConfigured()) {
    throw new FapshiPayoutError("Fapshi payout service is not configured", 500);
  }

  const payoutBaseUrl = getPayoutBaseUrl();
  const res = await fetch(`${payoutBaseUrl}/payment-status/${encodeURIComponent(transId)}`, {
    method: "GET",
    headers: authHeaders(),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new FapshiPayoutError(body?.message ?? "Fapshi payout status request failed", res.status);
  }
  return body as PayoutStatusResult;
}

export { FapshiPayoutError };
