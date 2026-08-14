// Fapshi payment gateway client. API reference: https://docs.fapshi.com
// Auth: `apiuser` / `apikey` headers on every request (not bearer tokens).

const FAPSHI_BASE_URL = process.env.FAPSHI_BASE_URL ?? "https://sandbox.fapshi.com";
const FAPSHI_API_USER = process.env.FAPSHI_API_USER ?? "";
const FAPSHI_API_KEY = process.env.FAPSHI_API_KEY ?? "";

export type FapshiPaymentStatus = "CREATED" | "PENDING" | "SUCCESSFUL" | "FAILED" | "EXPIRED";

export interface InitiatePayParams {
  amount: number;
  email?: string;
  redirectUrl?: string;
  userId?: string;
  externalId?: string;
  message?: string;
}

export interface InitiatePayResult {
  message: string;
  link: string;
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

export async function initiatePayment(params: InitiatePayParams): Promise<InitiatePayResult> {
  if (params.amount < 100) {
    throw new FapshiError("Amount must be at least 100 XAF", 400);
  }

  const res = await fetch(`${FAPSHI_BASE_URL}/initiate-pay`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(params),
  });

  const body = await res.json();
  if (!res.ok) {
    throw new FapshiError(body?.message ?? "Fapshi initiate-pay request failed", res.status);
  }
  return body as InitiatePayResult;
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
