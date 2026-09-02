import { describe, it, expect, vi, beforeEach } from "vitest";

const findManySlot = vi.fn();
const assertPriorCyclePaidOut = vi.fn();
const initiateDirectPayment = vi.fn();

// Transaction mock: exposes the tx's own $queryRaw (the SELECT ... FOR
// UPDATE locks) plus contribution/fine/bulkPayment scoped to the lock,
// separate from the top-level prisma.bulkPayment.update / contribution.
// updateMany / paymentAttempt.create used afterward (outside the lock) to
// record the Fapshi result — same split as initiate-slot-payment.test.ts.
const txQueryRaw = vi.fn().mockResolvedValue(undefined);
const txFindUniqueContribution = vi.fn();
const txUpdateContribution = vi.fn();
const txCreateContribution = vi.fn();
const txFindUniqueFine = vi.fn();
const txCreateBulkPayment = vi.fn();

const updateBulkPayment = vi.fn();
const updateManyContribution = vi.fn();
const createPaymentAttempt = vi.fn().mockResolvedValue({});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    membershipSlot: { findMany: (...a: unknown[]) => findManySlot(...a) },
    bulkPayment: { update: (...a: unknown[]) => updateBulkPayment(...a) },
    contribution: { updateMany: (...a: unknown[]) => updateManyContribution(...a) },
    paymentAttempt: { create: (...a: unknown[]) => createPaymentAttempt(...a) },
    $transaction: async (cbOrOps: ((tx: unknown) => unknown) | Promise<unknown>[]) => {
      if (typeof cbOrOps === "function") {
        return cbOrOps({
          $queryRaw: (...a: unknown[]) => txQueryRaw(...a),
          contribution: {
            findUnique: (...a: unknown[]) => txFindUniqueContribution(...a),
            update: (...a: unknown[]) => txUpdateContribution(...a),
            create: (...a: unknown[]) => txCreateContribution(...a),
          },
          fine: { findUnique: (...a: unknown[]) => txFindUniqueFine(...a) },
          bulkPayment: { create: (...a: unknown[]) => txCreateBulkPayment(...a) },
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

import { initiateBulkPayment } from "@/lib/initiate-bulk-payment";

const VALID_PHONE = "677123456";

function makeSlot(
  id: string,
  overrides: Partial<{ userId: string; status: string; sessionStatus: string; isPaused: boolean; sessionId: string }> = {},
) {
  const sessionId = overrides.sessionId ?? "session-1";
  return {
    id,
    beneficiaryName: `Slot ${id}`,
    membership: {
      userId: overrides.userId ?? "member-1",
      status: overrides.status ?? "APPROVED",
      tontineSessionId: sessionId,
      tontineSession: {
        id: sessionId,
        type: "HEBDO_SUNDAY" as const,
        status: overrides.sessionStatus ?? "ACTIVE",
        isPaused: overrides.isPaused ?? false,
        startDate: new Date("2020-01-01"),
        amount: 2500,
        fee: 100,
      },
    },
  };
}

describe("initiateBulkPayment", () => {
  beforeEach(() => {
    findManySlot.mockReset();
    assertPriorCyclePaidOut.mockReset();
    initiateDirectPayment.mockReset();
    txQueryRaw.mockClear();
    txFindUniqueContribution.mockReset();
    txUpdateContribution.mockReset();
    txCreateContribution.mockReset();
    txFindUniqueFine.mockReset();
    txCreateBulkPayment.mockReset();
    updateBulkPayment.mockReset();
    updateManyContribution.mockReset();
    createPaymentAttempt.mockClear();

    assertPriorCyclePaidOut.mockResolvedValue({ ok: true });
    txFindUniqueFine.mockResolvedValue(null);
  });

  it("rejects an invalid phone number before touching the database", async () => {
    const result = await initiateBulkPayment("member-1", ["slot-1"], "123");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
    expect(findManySlot).not.toHaveBeenCalled();
  });

  it("rejects an empty slot selection", async () => {
    const result = await initiateBulkPayment("member-1", [], VALID_PHONE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("rejects when a selected slot doesn't belong to the caller", async () => {
    findManySlot.mockResolvedValue([makeSlot("slot-1", { userId: "someone-else" })]);
    const result = await initiateBulkPayment("member-1", ["slot-1"], VALID_PHONE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
    expect(txCreateBulkPayment).not.toHaveBeenCalled();
  });

  it("rejects when one slot's session isn't ACTIVE", async () => {
    findManySlot.mockResolvedValue([makeSlot("slot-1", { sessionStatus: "DRAWING" })]);
    const result = await initiateBulkPayment("member-1", ["slot-1"], VALID_PHONE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });

  it("rejects when the round-robin lock blocks one of the sessions", async () => {
    findManySlot.mockResolvedValue([makeSlot("slot-1")]);
    assertPriorCyclePaidOut.mockResolvedValue({ ok: false, status: 409, error: "prior cycle not paid out" });
    const result = await initiateBulkPayment("member-1", ["slot-1"], VALID_PHONE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/prior cycle/);
  });

  it("blocks the whole bulk payment when any included slot is already PAID this cycle", async () => {
    findManySlot.mockResolvedValue([makeSlot("slot-1"), makeSlot("slot-2")]);
    txFindUniqueContribution.mockImplementation((args: { where: { membershipSlotId_dueDate: { membershipSlotId: string } } }) =>
      args.where.membershipSlotId_dueDate.membershipSlotId === "slot-2" ? { status: "PAID" } : null,
    );

    const result = await initiateBulkPayment("member-1", ["slot-1", "slot-2"], VALID_PHONE);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toMatch(/already paid/i);
    }
    expect(txCreateBulkPayment).not.toHaveBeenCalled();
    expect(initiateDirectPayment).not.toHaveBeenCalled();
  });

  it("blocks the whole bulk payment when any included slot has a payment already in flight", async () => {
    findManySlot.mockResolvedValue([makeSlot("slot-1"), makeSlot("slot-2")]);
    txFindUniqueContribution.mockImplementation((args: { where: { membershipSlotId_dueDate: { membershipSlotId: string } } }) =>
      args.where.membershipSlotId_dueDate.membershipSlotId === "slot-2"
        ? { status: "PENDING", fapshiTxRef: "tx-inflight", updatedAt: new Date() }
        : null,
    );

    const result = await initiateBulkPayment("member-1", ["slot-1", "slot-2"], VALID_PHONE);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/already in progress/i);
    expect(initiateDirectPayment).not.toHaveBeenCalled();
  });

  it("locks every selected slot in sorted order, regardless of input order — deadlock avoidance for overlapping bulk payments", async () => {
    findManySlot.mockResolvedValue([makeSlot("slot-b"), makeSlot("slot-a")]);
    txFindUniqueContribution.mockResolvedValue(null);
    txCreateBulkPayment.mockResolvedValue({ id: "bulk-1" });
    txCreateContribution.mockResolvedValue({});
    initiateDirectPayment.mockResolvedValue({ transId: "tx-1" });

    await initiateBulkPayment("member-1", ["slot-b", "slot-a"], VALID_PHONE);

    const lockedIds = txQueryRaw.mock.calls.map((call) => call[1]);
    expect(lockedIds).toEqual(["slot-a", "slot-b"]);
  });

  it("creates one BulkPayment and one linked Contribution per slot, then calls Fapshi once for the combined total", async () => {
    findManySlot.mockResolvedValue([makeSlot("slot-1"), makeSlot("slot-2")]);
    txFindUniqueContribution.mockResolvedValue(null);
    txCreateBulkPayment.mockResolvedValue({ id: "bulk-1" });
    txCreateContribution.mockResolvedValue({});
    initiateDirectPayment.mockResolvedValue({ transId: "tx-combined" });
    updateBulkPayment.mockResolvedValue({});

    const result = await initiateBulkPayment("member-1", ["slot-1", "slot-2"], VALID_PHONE);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.transId).toBe("tx-combined");

    // amount+fee per slot = 2600, x2 slots = 5200 base — Fapshi is charged
    // the combined total including the provider fee, once, not per slot.
    expect(initiateDirectPayment).toHaveBeenCalledTimes(1);
    expect(initiateDirectPayment.mock.calls[0][0].amount).toBeGreaterThan(5200);

    expect(txCreateContribution).toHaveBeenCalledTimes(2);
    for (const call of txCreateContribution.mock.calls) {
      expect(call[0].data.bulkPaymentId).toBe("bulk-1");
    }

    expect(createPaymentAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ transId: "tx-combined", bulkPaymentId: "bulk-1" }) }),
    );
  });

  it("marks the BulkPayment and its contributions FAILED (not left PENDING) when Fapshi's request throws", async () => {
    findManySlot.mockResolvedValue([makeSlot("slot-1")]);
    txFindUniqueContribution.mockResolvedValue(null);
    txCreateBulkPayment.mockResolvedValue({ id: "bulk-2" });
    txCreateContribution.mockResolvedValue({});
    initiateDirectPayment.mockRejectedValue(new Error("network blip"));
    updateBulkPayment.mockResolvedValue({});
    updateManyContribution.mockResolvedValue({});

    const result = await initiateBulkPayment("member-1", ["slot-1"], VALID_PHONE);

    expect(result.ok).toBe(false);
    expect(updateBulkPayment).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "bulk-2" }, data: expect.objectContaining({ status: "FAILED" }) }),
    );
    expect(updateManyContribution).toHaveBeenCalledWith(
      expect.objectContaining({ where: { bulkPaymentId: "bulk-2" }, data: expect.objectContaining({ status: "FAILED" }) }),
    );
  });
});
