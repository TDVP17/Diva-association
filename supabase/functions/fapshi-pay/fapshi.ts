/**
 * Client passerelle Fapshi pour Supabase Edge Functions (Deno).
 * Référence API : https://docs.fapshi.com
 *
 * IMPORTANT SÉCURITÉ : Aucune clé n'est codée en dur. Toutes les clés sont lues
 * exclusivement depuis les secrets Supabase (`Deno.env.get(...)`) :
 * - FAPSHI_API_KEY (obligatoire)
 * - FAPSHI_API_USER (obligatoire pour l'en-tête `apiuser` exigé par Fapshi)
 * - FAPSHI_WEBHOOK_SECRET (obligatoire pour vérifier `x-wh-secret` sur le webhook)
 * - FAPSHI_BASE_URL (optionnel, défaut auto live/sandbox)
 * - FAPSHI_PAYOUT_API_KEY / FAPSHI_PAYOUT_API_USER / FAPSHI_PAYOUT_BASE_URL (optionnels, remboursements auto)
 * - FAPSHI_PAYOUT_WEBHOOK_SECRET (optionnel)
 * - APP_URL (optionnel, défaut https://www.divaasso.com)
 */

export type FapshiPaymentStatus =
  | "CREATED"
  | "PENDING"
  | "SUCCESSFUL"
  | "COMPLETED"
  | "FAILED"
  | "EXPIRED";

export type MobileMoneyProvider = "ORANGE" | "MTN";

export interface InitiateDirectPayParams {
  amount: number;
  phone: string;
  medium?: "mobile money" | "orange money";
  name?: string;
  email?: string;
  userId?: string;
  externalId?: string;
  message?: string;
  redirectUrl?: string;
}

export interface InitiateHostedPayParams {
  amount: number;
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
  reason?: string | null;
  financialTransId: string | null;
  dateInitiated: string;
  dateConfirmed: string | null;
}

export interface PayoutParams {
  amount: number;
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

export interface ProviderFeeBreakdown {
  baseAmount: number;
  providerFeeAmount: number;
  providerShareAmount: number;
  presidentFeeShareAmount: number;
  totalCharged: number;
}

export class FapshiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "FapshiError";
  }
}

function cleanEnv(name: string): string {
  const val = Deno.env.get(name);
  if (!val) return "";
  return val.trim().replace(/^["']|["']$/g, "");
}

export function getAppBaseUrl(): string {
  const envUrl = cleanEnv("APP_URL").replace(/\/+$/, "");
  return envUrl || "https://www.divaasso.com";
}

export function getFapshiBaseUrl(): string {
  const envUrl = cleanEnv("FAPSHI_BASE_URL").replace(/\/+$/, "");
  if (envUrl) return envUrl;
  const apiKey = cleanEnv("FAPSHI_API_KEY");
  if (
    apiKey &&
    !apiKey.toLowerCase().includes("test") &&
    !apiKey.toLowerCase().includes("sandbox")
  ) {
    return "https://live.fapshi.com";
  }
  return "https://sandbox.fapshi.com";
}

export function getFapshiApiUser(): string {
  return cleanEnv("FAPSHI_API_USER");
}

export function getFapshiApiKey(): string {
  return cleanEnv("FAPSHI_API_KEY");
}

export function getFapshiPayoutBaseUrl(): string {
  const envUrl = cleanEnv("FAPSHI_PAYOUT_BASE_URL").replace(/\/+$/, "");
  return envUrl || getFapshiBaseUrl();
}

export function getFapshiPayoutApiUser(): string {
  return cleanEnv("FAPSHI_PAYOUT_API_USER") || getFapshiApiUser();
}

export function getFapshiPayoutApiKey(): string {
  return cleanEnv("FAPSHI_PAYOUT_API_KEY") || getFapshiApiKey();
}

function collectionHeaders(): Record<string, string> {
  return {
    apiuser: getFapshiApiUser(),
    apikey: getFapshiApiKey(),
    "Content-Type": "application/json",
  };
}

/** Comparaison en temps constant pour éviter les attaques temporelles sur le secret webhook. */
function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

/** Vérifie l'en-tête `x-wh-secret` envoyé par Fapshi par rapport à FAPSHI_WEBHOOK_SECRET. */
export function verifyWebhookSecret(receivedSecret: string | null): boolean {
  if (!receivedSecret) return false;
  const candidates = [
    cleanEnv("FAPSHI_WEBHOOK_SECRET"),
    cleanEnv("FAPSHI_PAYOUT_WEBHOOK_SECRET"),
  ].filter(Boolean);
  if (candidates.length === 0) return false;
  return candidates.some((expected) => timingSafeEqualStr(receivedSecret, expected));
}

/** Normalise un numéro camerounais sur 9 chiffres sans indicatif 237 (ex: "677123456"). */
export function normalizeCameroonPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const trimmed = digits.startsWith("237") ? digits.slice(3) : digits;
  return /^[6-9]\d{8}$/.test(trimmed) ? trimmed : null;
}

const MTN_PREFIXES = [
  "650",
  "651",
  "652",
  "653",
  "654",
  "680",
  "681",
  "682",
  "683",
  "684",
  "67",
];
const ORANGE_PREFIXES = [
  "655",
  "656",
  "657",
  "658",
  "659",
  "685",
  "686",
  "687",
  "688",
  "689",
  "69",
];

export function detectMobileMoneyProvider(
  normalizedPhone: string,
): MobileMoneyProvider | null {
  if (MTN_PREFIXES.some((prefix) => normalizedPhone.startsWith(prefix))) {
    return "MTN";
  }
  if (ORANGE_PREFIXES.some((prefix) => normalizedPhone.startsWith(prefix))) {
    return "ORANGE";
  }
  return null;
}

export function fapshiMediumFor(
  provider: MobileMoneyProvider,
): "mobile money" | "orange money" {
  return provider === "ORANGE" ? "orange money" : "mobile money";
}

/**
 * Frais Fapshi identiques au backend existant :
 * 3.1% au total = 2.8% Fapshi + 0.3% Présidente (arrondis au franc entier).
 */
export function computeProviderFee(baseAmount: number): ProviderFeeBreakdown {
  const totalRate = 0.031;
  const presidentRate = 0.003;
  const providerFeeAmount = Math.round(baseAmount * totalRate);
  const presidentFeeShareAmount = Math.round(baseAmount * presidentRate);
  const providerShareAmount = providerFeeAmount - presidentFeeShareAmount;

  return {
    baseAmount,
    providerFeeAmount,
    providerShareAmount,
    presidentFeeShareAmount,
    totalCharged: baseAmount + providerFeeAmount,
  };
}

/**
 * Déclenche un push USSD direct (`/direct-pay`) sur le téléphone Mobile Money /
 * Orange Money du payeur, avec repli automatique vers `/initiate-pay` si Direct Pay
 * renvoie 403 (`activate-direct-pay`).
 */
export async function initiateDirectPayment(
  params: InitiateDirectPayParams,
): Promise<InitiateDirectPayResult> {
  if (params.amount < 100) {
    throw new FapshiError("Amount must be at least 100 XAF", 400);
  }
  const apiUser = getFapshiApiUser();
  const apiKey = getFapshiApiKey();
  if (!apiUser || !apiKey) {
    throw new FapshiError(
      "Fapshi is not configured (missing FAPSHI_API_KEY or FAPSHI_API_USER)",
      500,
    );
  }

  const baseUrl = getFapshiBaseUrl();
  const res = await fetch(`${baseUrl}/direct-pay`, {
    method: "POST",
    headers: collectionHeaders(),
    body: JSON.stringify({
      amount: Math.round(params.amount),
      phone: params.phone,
      medium: params.medium,
      name: params.name,
      email: params.email,
      userId: params.userId,
      externalId: params.externalId,
      message: params.message,
    }),
  });

  const body = await res.json().catch(() => null);
  if (res.ok && body?.transId) {
    return body as InitiateDirectPayResult;
  }

  const isDirectPayDisabled =
    res.status === 403 &&
    typeof body?.message === "string" &&
    (body.message.includes("activate-direct-pay") ||
      body.message.includes("Forbidden request"));

  if (isDirectPayDisabled) {
    return await initiateHostedPayment({
      amount: params.amount,
      email: params.email,
      userId: params.userId,
      externalId: params.externalId,
      message: params.message,
      redirectUrl: params.redirectUrl || getAppBaseUrl(),
    });
  }

  throw new FapshiError(
    body?.message ?? "Fapshi payment request failed",
    res.status,
  );
}

/** Génère un lien de paiement hébergé Fapshi (`/initiate-pay`). */
export async function initiateHostedPayment(
  params: InitiateHostedPayParams,
): Promise<InitiateDirectPayResult> {
  if (params.amount < 100) {
    throw new FapshiError("Amount must be at least 100 XAF", 400);
  }
  const apiUser = getFapshiApiUser();
  const apiKey = getFapshiApiKey();
  if (!apiUser || !apiKey) {
    throw new FapshiError(
      "Fapshi is not configured (missing FAPSHI_API_KEY or FAPSHI_API_USER)",
      500,
    );
  }

  const baseUrl = getFapshiBaseUrl();
  const redirectUrl = params.redirectUrl || getAppBaseUrl();

  const initRes = await fetch(`${baseUrl}/initiate-pay`, {
    method: "POST",
    headers: collectionHeaders(),
    body: JSON.stringify({
      amount: Math.round(params.amount),
      email: params.email,
      userId: params.userId,
      externalId: params.externalId,
      message: params.message,
      redirectUrl,
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

  throw new FapshiError(
    initBody?.message ?? "Fapshi hosted payment request failed",
    initRes.status,
  );
}

/** Vérifie directement le statut d'une transaction auprès de Fapshi (`/payment-status/:transId`). */
export async function getPaymentStatus(
  transId: string,
): Promise<PaymentStatusResult> {
  const apiUser = getFapshiApiUser();
  const apiKey = getFapshiApiKey();
  if (!apiUser || !apiKey) {
    throw new FapshiError(
      "Fapshi is not configured (missing FAPSHI_API_KEY or FAPSHI_API_USER)",
      500,
    );
  }

  const baseUrl = getFapshiBaseUrl();
  const res = await fetch(
    `${baseUrl}/payment-status/${encodeURIComponent(transId)}`,
    {
      method: "GET",
      headers: collectionHeaders(),
    },
  );

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new FapshiError(
      body?.message ?? "Fapshi payment-status request failed",
      res.status,
    );
  }
  return body as PaymentStatusResult;
}

export function isPayoutConfigured(): boolean {
  return Boolean(getFapshiPayoutApiUser() && getFapshiPayoutApiKey());
}

/** Envoie un remboursement automatique via le service Payout Fapshi (cas de double paiement). */
export async function initiatePayout(
  params: PayoutParams,
): Promise<PayoutResult> {
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
    body: JSON.stringify({
      ...params,
      amount: Math.round(params.amount),
    }),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new FapshiError(
      body?.message ?? "Fapshi payout request failed",
      res.status,
    );
  }
  return body as PayoutResult;
}

