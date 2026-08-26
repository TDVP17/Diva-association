import { describe, it, expect } from "vitest";
import {
  computeFine,
  getCycleDateForRound,
  getContributionTotal,
  isContributionDay,
  getNextDueDate,
} from "@/lib/tontine-engine";

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
