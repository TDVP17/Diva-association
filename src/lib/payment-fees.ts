import type { PaymentProvider } from "@/generated/prisma/enums";

/**
 * Fapshi's payment-processing fee, charged to the payer on top of the
 * contribution amount they already owe. Confirmed business rule:
 *
 *   Fapshi: 3.3% total = 3.0% Fapshi + 0.3% President
 *
 * The internal split (which slice goes to the gateway vs the President)
 * is never shown to ordinary users — only the combined total fee and the
 * total amount to be deducted. See requirePresident() in
 * src/lib/require-admin.ts for where the split itself is protected.
 */
export const PROVIDER_FEE_CONFIG: Record<PaymentProvider, { totalRate: number; presidentRate: number }> = {
  FAPSHI: { totalRate: 0.033, presidentRate: 0.003 },
};

export interface ProviderFeeBreakdown {
  /** The amount the fee is calculated on — contribution + service fee + any fine, before the provider fee itself. */
  baseAmount: number;
  /** Total fee charged to the payer (e.g. 330 F on a 10,000 F base at Fapshi's 3.3%). This alone is what users may see. */
  providerFeeAmount: number;
  /** The gateway's own cut of providerFeeAmount — President-only visibility. */
  providerShareAmount: number;
  /** The President's cut of providerFeeAmount — President-only visibility. */
  presidentFeeShareAmount: number;
  /** baseAmount + providerFeeAmount — what actually gets charged/deducted. */
  totalCharged: number;
}

/**
 * Computes a payment gateway's processing fee and its internal split.
 * Rounds each amount to the nearest whole franc (XAF has no subunit in
 * practice, and the app already stores/displays whole-franc amounts
 * everywhere) — providerShareAmount is derived by subtraction rather than
 * rounded independently, so providerShareAmount + presidentFeeShareAmount
 * always equals providerFeeAmount exactly, with no rounding drift.
 */
export function computeProviderFee(provider: PaymentProvider, baseAmount: number): ProviderFeeBreakdown {
  const config = PROVIDER_FEE_CONFIG[provider];
  const providerFeeAmount = Math.round(baseAmount * config.totalRate);
  const presidentFeeShareAmount = Math.round(baseAmount * config.presidentRate);
  const providerShareAmount = providerFeeAmount - presidentFeeShareAmount;

  return {
    baseAmount,
    providerFeeAmount,
    providerShareAmount,
    presidentFeeShareAmount,
    totalCharged: baseAmount + providerFeeAmount,
  };
}
