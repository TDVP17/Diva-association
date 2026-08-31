import { describe, it, expect } from "vitest";
import { computeProviderFee, PROVIDER_FEE_CONFIG } from "@/lib/payment-fees";

describe("computeProviderFee", () => {
  it("Fapshi: charges 3.3% total, split 3.0% gateway / 0.3% president", () => {
    const result = computeProviderFee("FAPSHI", 10000);
    expect(result.providerFeeAmount).toBe(330); // 3.3% of 10,000
    expect(result.providerShareAmount).toBe(300); // 3.0% of 10,000
    expect(result.presidentFeeShareAmount).toBe(30); // 0.3% of 10,000
    expect(result.totalCharged).toBe(10330);
  });

  it("the gateway share and president share always sum exactly to the total fee — no rounding drift", () => {
    // Amounts deliberately chosen so 3.0%/0.3% each round to fractional
    // francs on their own — the two shares must still sum exactly.
    const amounts = [1, 7, 33, 99, 101, 333, 1001, 2500, 12345, 999999];
    for (const amount of amounts) {
      const result = computeProviderFee("FAPSHI", amount);
      expect(result.providerShareAmount + result.presidentFeeShareAmount).toBe(result.providerFeeAmount);
      expect(result.baseAmount + result.providerFeeAmount).toBe(result.totalCharged);
    }
  });

  it("rounds the total fee to the nearest whole franc", () => {
    // 2500 * 0.033 = 82.5 -> rounds to 83
    const result = computeProviderFee("FAPSHI", 2500);
    expect(result.providerFeeAmount).toBe(83);
    expect(Number.isInteger(result.providerFeeAmount)).toBe(true);
    expect(Number.isInteger(result.providerShareAmount)).toBe(true);
    expect(Number.isInteger(result.presidentFeeShareAmount)).toBe(true);
  });

  it("returns 0 fees for a 0 base amount", () => {
    const result = computeProviderFee("FAPSHI", 0);
    expect(result.providerFeeAmount).toBe(0);
    expect(result.providerShareAmount).toBe(0);
    expect(result.presidentFeeShareAmount).toBe(0);
    expect(result.totalCharged).toBe(0);
  });

  it("matches the confirmed business rate exactly", () => {
    expect(PROVIDER_FEE_CONFIG.FAPSHI).toEqual({ totalRate: 0.033, presidentRate: 0.003 });
  });
});
