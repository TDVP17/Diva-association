export interface FallbackPaymentConfigData {
  orangeUssdCode: string;
  orangeBeneficiaryName: string;
  mtnUssdCode: string;
  mtnBeneficiaryName: string;
}

export const EMPTY_FALLBACK_PAYMENT_CONFIG: FallbackPaymentConfigData = {
  orangeUssdCode: "",
  orangeBeneficiaryName: "",
  mtnUssdCode: "",
  mtnBeneficiaryName: "",
};

/**
 * Formats an admin-supplied USSD code/template or merchant number by dynamically
 * injecting the exact total amount owed across all member names being paid for.
 *
 * Supports:
 * - Explicit `{montant}` or `{amount}` placeholders: `#150*11*699000000*{montant}#`
 * - Base USSD prefix without amount: `#150*11*699000000#` -> `#150*11*699000000*3100#`
 * - Full USSD string where admin typed a sample amount: `#150*11*699000000*1550#` -> `#150*11*699000000*3100#`
 * - Plain 9-digit phone or merchant code: `699000000` -> `#150*11*699000000*3100#` (Orange) / `*126*1*1*677000000*3100#` (MTN)
 */
export function formatMerchantUssdCode(
  rawTemplate: string | null | undefined,
  totalAmount: number,
  provider: "ORANGE" | "MTN" = "ORANGE",
): string {
  const trimmed = (rawTemplate ?? "").trim();
  if (!trimmed) return "";

  const amt = Math.max(0, Math.round(Number.isFinite(totalAmount) ? totalAmount : 0));

  // 1. Explicit {montant} / {amount} placeholder (also strips any accidental leftover prefix digits like *1{montant} or *1550{montant})
  if (/\{(montant|amount)\}/i.test(trimmed)) {
    if (amt > 0) {
      return trimmed.replace(/\d*\{(montant|amount)\}/gi, String(amt));
    }
    return trimmed.replace(/\*?\d*\{(montant|amount)\}/gi, "");
  }

  // 2. Plain digits (phone number or merchant code)
  if (/^\d+$/.test(trimmed)) {
    const isPhone = /^[6-9]\d{8}$/.test(trimmed);
    if (provider === "ORANGE") {
      const prefix = isPhone ? `#150*11*${trimmed}` : `#150*14*${trimmed}`;
      return amt > 0 ? `${prefix}*${amt}#` : `${prefix}#`;
    }
    const prefix = isPhone ? `*126*1*1*${trimmed}` : `*126*4*${trimmed}`;
    return amt > 0 ? `${prefix}*${amt}#` : `${prefix}#`;
  }

  // 3. Known Orange / MTN USSD patterns where an example trailing amount might already be present
  const orangeWithAmt = trimmed.match(/^(#150\*(?:11|14|46|47)\*\d+)\*(\d+)#$/);
  if (orangeWithAmt) {
    return amt > 0 ? `${orangeWithAmt[1]}*${amt}#` : `${orangeWithAmt[1]}#`;
  }

  const mtnPhoneWithAmt = trimmed.match(/^(\*126\*1\*1\*\d+)\*(\d+)#$/);
  if (mtnPhoneWithAmt) {
    return amt > 0 ? `${mtnPhoneWithAmt[1]}*${amt}#` : `${mtnPhoneWithAmt[1]}#`;
  }

  const mtnMerchantWithAmt = trimmed.match(/^(\*126\*(?:4|14)\*\d+)\*(\d+)#$/);
  if (mtnMerchantWithAmt) {
    return amt > 0 ? `${mtnMerchantWithAmt[1]}*${amt}#` : `${mtnMerchantWithAmt[1]}#`;
  }

  // 4. USSD string ending in '#' without amount yet (e.g. #150*11*699000000#)
  if (trimmed.endsWith("#")) {
    const withoutHash = trimmed.replace(/\*?#$/, "");
    return amt > 0 ? `${withoutHash}*${amt}#` : `${withoutHash}#`;
  }

  return amt > 0 ? `${trimmed}*${amt}` : trimmed;
}

/**
 * Resolves which operator fallback configuration(s) are available and picks
 * the best match for the payer's detected operator (falling back to whichever
 * operator the admin has configured if only one is filled in).
 */
export function resolveActiveFallbackMerchant(
  config: FallbackPaymentConfigData | null | undefined,
  preferredProvider: "ORANGE" | "MTN" | null,
  totalAmount: number,
): {
  provider: "ORANGE" | "MTN";
  ussdCode: string;
  beneficiaryName: string;
  alternate?: {
    provider: "ORANGE" | "MTN";
    ussdCode: string;
    beneficiaryName: string;
  };
} | null {
  if (!config) return null;

  const hasOrange = Boolean(config.orangeUssdCode.trim() || config.orangeBeneficiaryName.trim());
  const hasMtn = Boolean(config.mtnUssdCode.trim() || config.mtnBeneficiaryName.trim());

  if (!hasOrange && !hasMtn) return null;

  const orangeEntry = hasOrange
    ? {
        provider: "ORANGE" as const,
        ussdCode: formatMerchantUssdCode(config.orangeUssdCode, totalAmount, "ORANGE"),
        beneficiaryName: config.orangeBeneficiaryName.trim(),
      }
    : null;

  const mtnEntry = hasMtn
    ? {
        provider: "MTN" as const,
        ussdCode: formatMerchantUssdCode(config.mtnUssdCode, totalAmount, "MTN"),
        beneficiaryName: config.mtnBeneficiaryName.trim(),
      }
    : null;

  if (preferredProvider === "MTN" && mtnEntry) {
    return { ...mtnEntry, ...(orangeEntry ? { alternate: orangeEntry } : {}) };
  }
  if (preferredProvider === "ORANGE" && orangeEntry) {
    return { ...orangeEntry, ...(mtnEntry ? { alternate: mtnEntry } : {}) };
  }

  // Fallback to whichever is configured
  if (orangeEntry) {
    return { ...orangeEntry, ...(mtnEntry ? { alternate: mtnEntry } : {}) };
  }
  return mtnEntry;
}

