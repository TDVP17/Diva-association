import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => {
  return {
    prisma: {
      membership: {
        findMany: vi.fn(),
      },
      user: {
        findUnique: vi.fn(),
      },
      walletTransaction: {
        findMany: vi.fn(),
      },
      contribution: {
        aggregate: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
      },
      payout: {
        findMany: vi.fn(),
      },
    },
  };
});

import { prisma } from "@/lib/prisma";
import { getUserWalletFeeRate, getUserWalletData } from "@/lib/wallet";

describe("Wallet Fee Rates Logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("assigns 3.1% fee when member only has public cotisations", async () => {
    vi.mocked(prisma.membership.findMany).mockResolvedValueOnce([
      { tontineSession: { id: "s1", isPrivate: false } },
      { tontineSession: { id: "s2", isPrivate: false } },
    ] as any);

    const fee = await getUserWalletFeeRate("user-1");
    expect(fee.percentage).toBe(3.1);
    expect(fee.feeRate).toBe(0.031);
    expect(fee.isPrivateMember).toBe(false);
  });

  it("assigns 5.1% fee when member has a private cotisation", async () => {
    vi.mocked(prisma.membership.findMany).mockResolvedValueOnce([
      { tontineSession: { id: "s1", isPrivate: true } },
    ] as any);

    const fee = await getUserWalletFeeRate("user-2");
    expect(fee.percentage).toBe(5.1);
    expect(fee.feeRate).toBe(0.051);
    expect(fee.isPrivateMember).toBe(true);
  });

  it("assigns 5.1% fee when member has both public and private cotisations", async () => {
    vi.mocked(prisma.membership.findMany).mockResolvedValueOnce([
      { tontineSession: { id: "s1", isPrivate: false } },
      { tontineSession: { id: "s2", isPrivate: true } },
    ] as any);

    const fee = await getUserWalletFeeRate("user-3");
    expect(fee.percentage).toBe(5.1);
    expect(fee.feeRate).toBe(0.051);
    expect(fee.hasPublicAndPrivate).toBe(true);
  });

  it("assigns default 3.1% fee when member has no cotisations", async () => {
    vi.mocked(prisma.membership.findMany).mockResolvedValueOnce([] as any);

    const fee = await getUserWalletFeeRate("user-4");
    expect(fee.percentage).toBe(3.1);
    expect(fee.feeRate).toBe(0.031);
  });
});

describe("User Wallet Data (30-day window for member vs permanent for admin)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns user wallet data and formats balance", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "u1",
      name: "Jean Dupont",
      email: "jean@example.com",
      phone: "699112233",
      walletBalance: 25000 as any,
    } as any);

    vi.mocked(prisma.contribution.aggregate).mockResolvedValue({
      _sum: { amountPaid: 150000 as any },
    } as any);

    vi.mocked(prisma.membership.findMany).mockResolvedValue([
      { tontineSession: { id: "s1", isPrivate: false } },
    ] as any);

    vi.mocked(prisma.walletTransaction.findMany).mockResolvedValue([]);
    vi.mocked(prisma.contribution.findMany).mockResolvedValue([
      { amountPaid: 150000, membershipSlot: { beneficiaryName: "Jean", membership: { tontineSession: { title: "Dimanche", type: "WEEKLY" } } }, paidAt: new Date(), dueDate: new Date() } as any,
    ]);
    vi.mocked(prisma.payout.findMany).mockResolvedValue([]);
    vi.mocked(prisma.contribution.count).mockResolvedValue(0);

    const result = await getUserWalletData("u1");
    expect(result.user.walletBalance).toBe(25000);
    expect(result.totalContributed).toBe(150000);
    expect(result.feeInfo.percentage).toBe(3.1);
  });
});
