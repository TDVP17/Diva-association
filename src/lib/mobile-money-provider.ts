import type { MobileMoneyProvider } from "@/generated/prisma/enums";

// Cameroon MSISDN prefixes, as commonly documented for the two mobile
// money networks Fapshi supports. Numbers are checked longest-prefix-first
// so the 3-digit 65x/68x sub-ranges are matched before falling back to the
// 2-digit 67x/69x blocks that are wholly one network. These ranges are
// occasionally reassigned by regulators/operators — this is a best-effort
// mapping, not a guarantee, which is exactly why the app never lets the
// UI claim a provider on its own: this function is the single source of
// truth, always re-derived server-side from the number itself.
const MTN_PREFIXES = ["650", "651", "652", "653", "654", "680", "681", "682", "683", "684", "67"];
const ORANGE_PREFIXES = ["655", "656", "657", "658", "659", "685", "686", "687", "688", "689", "69"];

/**
 * Detects which Cameroonian mobile money network a normalized (9-digit,
 * no country code) phone number belongs to. Returns null for a number that
 * doesn't match a known Orange/MTN range (e.g. a landline-shaped or
 * Camtel/Nexttel number) — callers must treat null as "can't verify this
 * is Orange or MTN," not silently default to one.
 */
export function detectMobileMoneyProvider(normalizedPhone: string): MobileMoneyProvider | null {
  if (MTN_PREFIXES.some((prefix) => normalizedPhone.startsWith(prefix))) return "MTN";
  if (ORANGE_PREFIXES.some((prefix) => normalizedPhone.startsWith(prefix))) return "ORANGE";
  return null;
}

/** Fapshi's own `medium` values for its direct-pay/payout APIs — MTN routes through "mobile money", Orange through "orange money". */
export function fapshiMediumFor(provider: MobileMoneyProvider): "mobile money" | "orange money" {
  return provider === "ORANGE" ? "orange money" : "mobile money";
}
