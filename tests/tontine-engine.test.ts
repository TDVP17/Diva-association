import { describe, it, expect } from "vitest";
import {
  computeFine,
  getCycleDateForRound,
  getContributionTotal,
  isContributionDay,
  getNextDueDate,
  computeFeeSplitAmounts,
  getTontineConfig,
} from "@/lib/tontine-engine";
import type { TontineType } from "@/generated/prisma/enums";

describe("TONTINE_CONFIG.feeSplit", () => {
  const allTypes: TontineType[] = ["HEBDO_SUNDAY", "MONTHLY_28", "MONTHLY_25", "BIWEEKLY_SUNDAY", "QUARTERLY_25"];

  it("gives every contribution type the same 75/25 President/winner split", () => {
    for (const type of allTypes) {
      expect(getTontineConfig(type).feeSplit).toEqual({ presidentShare: 75, winnerShare: 25 });
    }
  });
});

describe("computeFeeSplitAmounts", () => {
  const split = { presidentShare: 75, winnerShare: 25 };

  it("splits a round total fees 75/25 President/winner", () => {
    const result = computeFeeSplitAmounts(10000, split);
    expect(result.president).toBe(7500);
    expect(result.winner).toBe(2500);
  });

  it("uses the session's own fee amount, not the global TONTINE_CONFIG.fee preset — regression test for a bug where the split was divided by config.fee instead of by 100", () => {
    // MONTHLY_28's global preset fee is 500 F, not 100 — a formula that
    // divided by config.fee (as the old buggy code did) would compute
    // 75 * totalFees / 500 = 15% here instead of the correct 75%.
    const result = computeFeeSplitAmounts(2000, split);
    expect(result.president).toBe(1500); // 75% of 2000
    expect(result.winner).toBe(500); // 25% of 2000
  });

  it("president + winner always sum exactly to totalFees — no rounding drift", () => {
    const totals = [1, 3, 7, 33, 99, 101, 333, 1001, 12345, 999999];
    for (const totalFees of totals) {
      const result = computeFeeSplitAmounts(totalFees, split);
      expect(result.president + result.winner).toBe(totalFees);
    }
  });

  it("returns 0/0 for 0 total fees", () => {
    const result = computeFeeSplitAmounts(0, split);
    expect(result.president).toBe(0);
    expect(result.winner).toBe(0);
  });
});

describe("computeFine", () => {
  const cutoff = new Date("2026-01-04T17:31:00Z"); // Sunday cutoff instant

  it("returns 0 before the cutoff has passed", () => {
    const now = new Date("2026-01-04T10:00:00Z");
    expect(computeFine("HEBDO_SUNDAY", now, cutoff)).toBe(0);
  });

  it("falls back to the global TONTINE_CONFIG table when no override is given", () => {
    const now = new Date(cutoff.getTime() + 60 * 60 * 1000); // 1h late
    expect(computeFine("HEBDO_SUNDAY", now, cutoff)).toBe(500); // one period at the global rate
  });

  it("uses the session's own override instead of the global table", () => {
    const now = new Date(cutoff.getTime() + 60 * 60 * 1000); // 1h late
    const fine = computeFine("HEBDO_SUNDAY", now, cutoff, {
      fineAmountPerPeriod: 1000,
      fineIntervalHours: 24,
    });
    expect(fine).toBe(1000);
  });

  it("scales with the number of elapsed intervals", () => {
    const now = new Date(cutoff.getTime() + 50 * 60 * 60 * 1000); // 50h late
    const fine = computeFine("HEBDO_SUNDAY", now, cutoff, {
      fineAmountPerPeriod: 100,
      fineIntervalHours: 24,
    });
    expect(fine).toBe(300); // ceil(50/24) = 3 periods
  });

  it("falls back per-field when only one override value is null", () => {
    const now = new Date(cutoff.getTime() + 60 * 60 * 1000);
    const fine = computeFine("HEBDO_SUNDAY", now, cutoff, {
      fineAmountPerPeriod: null,
      fineIntervalHours: 24,
    });
    expect(fine).toBe(500); // amount falls back to global (500), interval uses override (24)
  });
});

describe("getContributionTotal", () => {
  it("sums amount and fee from the session record, not TONTINE_CONFIG", () => {
    expect(getContributionTotal({ amount: 12345, fee: 678 })).toEqual({
      amount: 12345,
      fee: 678,
      total: 13023,
    });
  });
});

describe("getCycleDateForRound", () => {
  it("returns increasing dates for later rounds", () => {
    const startDate = new Date("2026-01-01T00:00:00Z");
    const round1 = getCycleDateForRound("HEBDO_SUNDAY", startDate, 1);
    const round3 = getCycleDateForRound("HEBDO_SUNDAY", startDate, 3);
    expect(round3.getTime()).toBeGreaterThan(round1.getTime());
  });

  it("round 1 lands on an actual contribution day", () => {
    const startDate = new Date("2026-01-01T00:00:00Z");
    const round1 = getCycleDateForRound("HEBDO_SUNDAY", startDate, 1);
    expect(isContributionDay("HEBDO_SUNDAY", round1)).toBe(true);
  });
});

describe("getNextDueDate", () => {
  it("always lands on a contribution day for the given type", () => {
    const next = getNextDueDate("MONTHLY_25", new Date("2026-03-01T00:00:00Z"));
    expect(isContributionDay("MONTHLY_25", next)).toBe(true);
  });
});

describe("new frequency presets", () => {
  it("QUARTERLY_25 only lands on the 25th of Jan/Apr/Jul/Oct", () => {
    expect(isContributionDay("QUARTERLY_25", new Date("2026-01-25T12:00:00Z"))).toBe(true);
    expect(isContributionDay("QUARTERLY_25", new Date("2026-04-25T12:00:00Z"))).toBe(true);
    expect(isContributionDay("QUARTERLY_25", new Date("2026-02-25T12:00:00Z"))).toBe(false);
    expect(isContributionDay("QUARTERLY_25", new Date("2026-01-24T12:00:00Z"))).toBe(false);
  });

  it("BIWEEKLY_SUNDAY only fires every other Sunday, never on a non-Sunday", () => {
    expect(isContributionDay("BIWEEKLY_SUNDAY", new Date("2026-01-05T12:00:00Z"))).toBe(false); // Monday
    const sundaysInARow: boolean[] = [];
    const cursor = new Date("2026-01-04T12:00:00Z"); // a Sunday
    for (let i = 0; i < 6; i++) {
      sundaysInARow.push(isContributionDay("BIWEEKLY_SUNDAY", cursor));
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }
    // Alternates true/false/true/false/... across consecutive Sundays.
    expect(sundaysInARow[0]).toBe(!sundaysInARow[1]);
    expect(sundaysInARow[1]).toBe(!sundaysInARow[2]);
    expect(sundaysInARow[0]).toBe(sundaysInARow[2]);
  });

  it("getNextDueDate resolves for both new frequencies without throwing", () => {
    expect(() => getNextDueDate("QUARTERLY_25", new Date("2026-01-01T00:00:00Z"))).not.toThrow();
    expect(() => getNextDueDate("BIWEEKLY_SUNDAY", new Date("2026-01-01T00:00:00Z"))).not.toThrow();
  });
});
