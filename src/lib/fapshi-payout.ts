// Separate Fapshi *service* dedicated purely to disbursements — Fapshi's
// platform rule is "a service with payouts enabled can no longer collect
// payments," so this deliberately uses its own API user/key, distinct from
// src/lib/fapshi.ts's collection service.

const FAPSHI_PAYOUT_BASE_URL = process.env.FAPSHI_PAYOUT_BASE_URL ?? "https://sandbox.fapshi.com";
const FAPSHI_PAYOUT_API_USER = process.env.FAPSHI_PAYOUT_API_USER ?? "";
const FAPSHI_PAYOUT_API_KEY = process.env.FAPSHI_PAYOUT_API_KEY ?? "";

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
    apiuser: FAPSHI_PAYOUT_API_USER,
    apikey: FAPSHI_PAYOUT_API_KEY,
    "Content-Type": "application/json",
  };
}

export async function sendPayout(params: PayoutParams): Promise<PayoutResult> {
  if (params.amount < 100) {
    throw new FapshiPayoutError("Amount must be at least 100 XAF", 400);
  }

  const res = await fetch(`${FAPSHI_PAYOUT_BASE_URL}/payout`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(params),
  });

  const body = await res.json();
  if (!res.ok) {
    throw new FapshiPayoutError(body?.message ?? "Fapshi payout request failed", res.status);
  }
  return body as PayoutResult;
}

export { FapshiPayoutError };
