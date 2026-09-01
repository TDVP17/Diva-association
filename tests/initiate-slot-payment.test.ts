import { describe, it, expect, vi, beforeEach } from "vitest";

const findUniqueSlot = vi.fn();
const findUniqueFine = vi.fn();
const updateContribution = vi.fn();
const createPaymentAttempt = vi.fn().mockResolvedValue({});
const assertPriorCyclePaidOut = vi.fn();
const initiateDirectPayment = vi.fn();

// Transaction mock: exposes its own tx.contribution.{findUnique,create,update}
// and a no-op tx.$queryRaw (stands in for the SELECT ... FOR UPDATE lock),
// separate from the top-level prisma.contribution.update/paymentAttempt.create
// used afterward (in their own array-form $transaction) to attach fapshiTxRef
// and record the PaymentAttempt ledger row once the lock is released.
const txFindUniqueContribution = vi.fn();
const txCreateContribution = vi.fn();
const txUpdateContribution = vi.fn();
const txQueryRaw = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    membershipSlot: { findUnique: (...a: unknown[]) => findUniqueSlot(...a) },
    fine: { findUnique: (...a: unknown[]) => findUniqueFine(...a) },
    contribution: { update: (...a: unknown[]) => updateContribution(...a) },
    paymentAttempt: { create: (...a: unknown[]) => createPaymentAttempt(...a) },
    $transaction: async (cbOrOps: ((tx: unknown) => unknown) | Promise<unknown>[]) => {
      if (typeof cbOrOps === "function") {
        return cbOrOps({
          $queryRaw: (...a: unknown[]) => txQueryRaw(...a),
          contribution: {
            findUnique: (...a: unknown[]) => txFindUniqueContribution(...a),
            create: (...a: unknown[]) => txCreateContribution(...a),
            update: (...a: unknown[]) => txUpdateContribution(...a),
          },
        });
      }
      return Promise.all(cbOrOps);
    },
  },
}));
vi.mock("@/lib/round-robin-lock", () => ({
  assertPriorCyclePaidOut: (...a: unknown[]) => assertPriorCyclePaidOut(...a),
}));
vi.mock("@/lib/fapshi", () => ({
  initiateDirectPayment: (...a: unknown[]) => initiateDirectPayment(...a),
  normalizeCameroonPhone: (raw: string) => {
    const digits = raw.replace(/\D/g, "");
    const trimmed = digits.startsWith("237") ? digits.slice(3) : digits;
    return /^[6-9]\d{8}$/.test(trimmed) ? trimmed : null;
  },
  FapshiError: class FapshiError extends Error {},
}));

import { initiateSlotPayment } from "@/lib/initiate-slot-payment";

const VALID_PHONE = "677123456";

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
    findUniqueFine.mockReset();
    updateContribution.mockReset();
    assertPriorCyclePaidOut.mockReset();
    initiateDirectPayment.mockReset();
    txFindUniqueContribution.mockReset();
    txCreateContribution.mockReset();
    txUpdateContribution.mockReset();
    txQueryRaw.mockClear();

    assertPriorCyclePaidOut.mockResolvedValue({ ok: true });
    findUniqueFine.mockResolvedValue(null);
  });

  it("rejects an invalid phone number before touching the database", async () => {
    const result = await initiateSlotPayment("slot-1", "123");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
    expect(findUniqueSlot).not.toHaveBeenCalled();
  });

  it("rejects a slot that doesn't exist", async () => {
    findUniqueSlot.mockResolvedValue(null);
    const result = await initiateSlotPayment("missing-slot", VALID_PHONE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });

  it("rejects when the session is paused", async () => {
    findUniqueSlot.mockResolvedValue({
      ...approvedActiveSlot,
      membership: { ...approvedActiveSlot.membership, tontineSession: { ...approvedActiveSlot.membership.tontineSession, isPaused: true } },
    });
    const result = await initiateSlotPayment("slot-1", VALID_PHONE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });

  it("rejects when the round-robin lock blocks a new cycle", async () => {
    findUniqueSlot.mockResolvedValue(approvedActiveSlot);
    assertPriorCyclePaidOut.mockResolvedValue({ ok: false, status: 409, error: "prior cycle not paid out" });
    const result = await initiateSlotPayment("slot-1", VALID_PHONE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/prior cycle/);
  });

  it("blocks a duplicate payment when the cycle is already PAID — the core anti-double-contribution guard", async () => {
    findUniqueSlot.mockResolvedValue(approvedActiveSlot);
    txFindUniqueContribution.mockResolvedValue({ status: "PAID" });
    const result = await initiateSlotPayment("slot-1", VALID_PHONE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toMatch(/already paid/i);
    }
    expect(txCreateContribution).not.toHaveBeenCalled();
  });

  it("blocks a second concurrent attempt while one is already in flight for this slot+cycle", async () => {
    findUniqueSlot.mockResolvedValue(approvedActiveSlot);
    txFindUniqueContribution.mockResolvedValue({
      status: "PENDING",
      fapshiTxRef: "tx-already-in-flight",
      updatedAt: new Date(), // just claimed a moment ago
    });
    const result = await initiateSlotPayment("slot-1", VALID_PHONE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toMatch(/already in progress/i);
    }
    expect(txCreateContribution).not.toHaveBeenCalled();
    expect(txUpdateContribution).not.toHaveBeenCalled();
  });

  it("allows retrying a stale/abandoned PENDING attempt from long ago", async () => {
    findUniqueSlot.mockResolvedValue(approvedActiveSlot);
    txFindUniqueContribution.mockResolvedValue({
      id: "contrib-old",
      status: "PENDING",
      fapshiTxRef: "tx-abandoned",
      updatedAt: new Date(Date.now() - 60 * 60 * 1000), // an hour ago — long stale
    });
    txUpdateContribution.mockResolvedValue({ id: "contrib-old" });
    initiateDirectPayment.mockResolvedValue({ transId: "tx-new" });
    updateContribution.mockResolvedValue({});

    const result = await initiateSlotPayment("slot-1", VALID_PHONE);
    expect(result.ok).toBe(true);
    expect(txUpdateContribution).toHaveBeenCalled();
  });

  it("threads paidByUserId from a relative/admin payer into the contribution row", async () => {
    findUniqueSlot.mockResolvedValue(approvedActiveSlot);
    txFindUniqueContribution.mockResolvedValue(null); // nothing paid yet this cycle
    txCreateContribution.mockResolvedValue({ id: "contrib-1" });
    initiateDirectPayment.mockResolvedValue({ transId: "tx-123" });
    updateContribution.mockResolvedValue({});

    const result = await initiateSlotPayment("slot-1", VALID_PHONE, { paidByUserId: "relative-1" });

    expect(result.ok).toBe(true);
    const createArgs = txCreateContribution.mock.calls[0][0];
    expect(createArgs.data.paidByUserId).toBe("relative-1");
    // The USSD prompt goes to the payer's own phone, not the beneficiary's.
    expect(initiateDirectPayment.mock.calls[0][0].phone).toBe(VALID_PHONE);
  });

  it("leaves paidByUserId unset for a normal self-pay (no relative/admin involved)", async () => {
    findUniqueSlot.mockResolvedValue(approvedActiveSlot);
    txFindUniqueContribution.mockResolvedValue(null);
    txCreateContribution.mockResolvedValue({ id: "contrib-2" });
    initiateDirectPayment.mockResolvedValue({ transId: "tx-456" });
    updateContribution.mockResolvedValue({});

    await initiateSlotPayment("slot-1", VALID_PHONE);

    const createArgs = txCreateContribution.mock.calls[0][0];
    expect(createArgs.data.paidByUserId).toBeUndefined();
  });

  it("marks the contribution FAILED (not left PENDING) when Fapshi's request itself throws", async () => {
    findUniqueSlot.mockResolvedValue(approvedActiveSlot);
    txFindUniqueContribution.mockResolvedValue(null);
    txCreateContribution.mockResolvedValue({ id: "contrib-3" });
    initiateDirectPayment.mockRejectedValue(new Error("network blip"));
    updateContribution.mockResolvedValue({});

    const result = await initiateSlotPayment("slot-1", VALID_PHONE);

    expect(result.ok).toBe(false);
    const failArgs = updateContribution.mock.calls.find((c) => c[0].data.status === "FAILED");
    expect(failArgs).toBeDefined();
  });
});
