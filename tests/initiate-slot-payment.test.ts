import { describe, it, expect, vi, beforeEach } from "vitest";

const findUniqueSlot = vi.fn();
const findUniqueContribution = vi.fn();
const findUniqueFine = vi.fn();
const upsertContribution = vi.fn();
const updateContribution = vi.fn();
const assertPriorCyclePaidOut = vi.fn();
const initiatePayment = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    membershipSlot: { findUnique: (...a: unknown[]) => findUniqueSlot(...a) },
    contribution: {
      findUnique: (...a: unknown[]) => findUniqueContribution(...a),
      upsert: (...a: unknown[]) => upsertContribution(...a),
      update: (...a: unknown[]) => updateContribution(...a),
    },
    fine: { findUnique: (...a: unknown[]) => findUniqueFine(...a) },
  },
}));
vi.mock("@/lib/round-robin-lock", () => ({
  assertPriorCyclePaidOut: (...a: unknown[]) => assertPriorCyclePaidOut(...a),
}));
vi.mock("@/lib/fapshi", () => ({
  initiatePayment: (...a: unknown[]) => initiatePayment(...a),
  FapshiError: class FapshiError extends Error {},
}));

import { initiateSlotPayment } from "@/lib/initiate-slot-payment";

const approvedActiveSlot = {
  id: "slot-1",
  beneficiaryName: "John Doe",
  membership: {
    userId: "member-1",
    status: "APPROVED",
    tontineSession: {
      id: "session-1",
      type: "HEBDO_SUNDAY",
      status: "ACTIVE",
      isPaused: false,
      startDate: new Date("2020-01-01"),
      amount: 2500,
      fee: 100,
    },
  },
};

describe("initiateSlotPayment", () => {
  beforeEach(() => {
    findUniqueSlot.mockReset();
    findUniqueContribution.mockReset();
    findUniqueFine.mockReset();
    upsertContribution.mockReset();
    updateContribution.mockReset();
    assertPriorCyclePaidOut.mockReset();
    initiatePayment.mockReset();

    assertPriorCyclePaidOut.mockResolvedValue({ ok: true });
    findUniqueFine.mockResolvedValue(null);
  });

  it("rejects a slot that doesn't exist", async () => {
    findUniqueSlot.mockResolvedValue(null);
    const result = await initiateSlotPayment("missing-slot", "https://app.test");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });

  it("rejects when the session is paused", async () => {
    findUniqueSlot.mockResolvedValue({
      ...approvedActiveSlot,
      membership: { ...approvedActiveSlot.membership, tontineSession: { ...approvedActiveSlot.membership.tontineSession, isPaused: true } },
    });
    const result = await initiateSlotPayment("slot-1", "https://app.test");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });

  it("rejects when the round-robin lock blocks a new cycle", async () => {
    findUniqueSlot.mockResolvedValue(approvedActiveSlot);
    assertPriorCyclePaidOut.mockResolvedValue({ ok: false, status: 409, error: "prior cycle not paid out" });
    const result = await initiateSlotPayment("slot-1", "https://app.test");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/prior cycle/);
  });

  it("blocks a duplicate payment when the cycle is already PAID — the core anti-double-contribution guard", async () => {
    findUniqueSlot.mockResolvedValue(approvedActiveSlot);
    findUniqueContribution.mockResolvedValue({ status: "PAID" });
    const result = await initiateSlotPayment("slot-1", "https://app.test");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toMatch(/already paid/i);
    }
    expect(upsertContribution).not.toHaveBeenCalled();
  });

  it("threads paidByUserId from a relative/admin payer into the contribution row", async () => {
    findUniqueSlot.mockResolvedValue(approvedActiveSlot);
    findUniqueContribution.mockResolvedValue(null); // nothing paid yet this cycle
    upsertContribution.mockResolvedValue({ id: "contrib-1" });
    initiatePayment.mockResolvedValue({ link: "https://pay.example/x", transId: "tx-123" });
    updateContribution.mockResolvedValue({});

    const result = await initiateSlotPayment("slot-1", "https://app.test", { paidByUserId: "relative-1" });

    expect(result.ok).toBe(true);
    const upsertArgs = upsertContribution.mock.calls[0][0];
    expect(upsertArgs.create.paidByUserId).toBe("relative-1");
    expect(upsertArgs.update.paidByUserId).toBe("relative-1");
  });

  it("leaves paidByUserId unset for a normal self-pay (no relative/admin involved)", async () => {
    findUniqueSlot.mockResolvedValue(approvedActiveSlot);
    findUniqueContribution.mockResolvedValue(null);
    upsertContribution.mockResolvedValue({ id: "contrib-2" });
    initiatePayment.mockResolvedValue({ link: "https://pay.example/y", transId: "tx-456" });
    updateContribution.mockResolvedValue({});

    await initiateSlotPayment("slot-1", "https://app.test");

    const upsertArgs = upsertContribution.mock.calls[0][0];
    expect(upsertArgs.create.paidByUserId).toBeUndefined();
  });
});
