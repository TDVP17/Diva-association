import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const contributionFindMany = vi.fn();
const fineFindMany = vi.fn();
const archiveFindMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    contribution: { findMany: (...a: unknown[]) => contributionFindMany(...a) },
    fine: { findMany: (...a: unknown[]) => fineFindMany(...a) },
    transactionArchive: { findMany: (...a: unknown[]) => archiveFindMany(...a) },
  },
}));

import { findYearsNeedingArchive } from "@/lib/transaction-archive";

describe("findYearsNeedingArchive", () => {
  beforeEach(() => {
    contributionFindMany.mockReset();
    fineFindMany.mockReset();
    archiveFindMany.mockReset();
    fineFindMany.mockResolvedValue([]);
    archiveFindMany.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("includes a year that has fully elapsed (a Dec 31 contribution, once 'now' is the following Jan 1 or later)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    contributionFindMany.mockResolvedValue([{ dueDate: new Date("2025-12-31T00:00:00Z") }]);

    const years = await findYearsNeedingArchive("user-1");
    expect(years).toEqual([2025]);
  });

  it("excludes the current, not-yet-elapsed year even with contributions in it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T00:00:00Z"));
    contributionFindMany.mockResolvedValue([{ dueDate: new Date("2026-03-01T00:00:00Z") }]);

    const years = await findYearsNeedingArchive("user-1");
    expect(years).toEqual([]);
  });

  it("excludes a year that already has a TransactionArchive row, even with matching contributions", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    contributionFindMany.mockResolvedValue([{ dueDate: new Date("2025-06-01T00:00:00Z") }]);
    archiveFindMany.mockResolvedValue([{ periodStart: new Date("2025-01-01T00:00:00Z") }]);

    const years = await findYearsNeedingArchive("user-1");
    expect(years).toEqual([]);
  });

  it("combines distinct years from both contributions and fines, sorted ascending", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    contributionFindMany.mockResolvedValue([{ dueDate: new Date("2024-05-01T00:00:00Z") }]);
    fineFindMany.mockResolvedValue([{ dueDate: new Date("2025-02-01T00:00:00Z") }]);

    const years = await findYearsNeedingArchive("user-1");
    expect(years).toEqual([2024, 2025]);
  });
});
