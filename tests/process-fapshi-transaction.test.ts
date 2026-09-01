import { describe, it, expect, vi, beforeEach } from "vitest";

const getPaymentStatus = vi.fn();
const settleContribution = vi.fn();
const settleFine = vi.fn();
const triggerAutomatedRefund = vi.fn();
const scheduleInAppNotifications = vi.fn();

const findUniquePaymentAttempt = vi.fn();
const updatePaymentAttempt = vi.fn();
const updateManyPaymentAttempt = vi.fn();
const findFirstMembershipSlot = vi.fn();
const findUniqueContribution = vi.fn();
const updateContribution = vi.fn();
const findUniqueFine = vi.fn();
const updateFine = vi.fn();

const txQueryRaw = vi.fn().mockResolvedValue(undefined);
const txFindUniqueContribution = vi.fn();
const txUpdateContribution = vi.fn();
const txFindUniqueFine = vi.fn();
const txUpdateFine = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    paymentAttempt: {
      findUnique: (...a: unknown[]) => findUniquePaymentAttempt(...a),
      update: (...a: unknown[]) => updatePaymentAttempt(...a),
      updateMany: (...a: unknown[]) => updateManyPaymentAttempt(...a),
    },
    membershipSlot: { findFirst: (...a: unknown[]) => findFirstMembershipSlot(...a) },
    contribution: {
      findUnique: (...a: unknown[]) => findUniqueContribution(...a),
      update: (...a: unknown[]) => updateContribution(...a),
    },
    fine: {
      findUnique: (...a: unknown[]) => findUniqueFine(...a),
      update: (...a: unknown[]) => updateFine(...a),
    },
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({
        $queryRaw: (...a: unknown[]) => txQueryRaw(...a),
        contribution: {
          findUnique: (...a: unknown[]) => txFindUniqueContribution(...a),
          update: (...a: unknown[]) => txUpdateContribution(...a),
        },
        fine: {
          findUnique: (...a: unknown[]) => txFindUniqueFine(...a),
          update: (...a: unknown[]) => txUpdateFine(...a),
        },
      }),
  },
}));
vi.mock("@/lib/fapshi", () => ({ getPaymentStatus: (...a: unknown[]) => getPaymentStatus(...a) }));
vi.mock("@/lib/settle-contribution", () => ({ settleContribution: (...a: unknown[]) => settleContribution(...a) }));
vi.mock("@/lib/settle-fine", () => ({ settleFine: (...a: unknown[]) => settleFine(...a) }));
vi.mock("@/lib/trigger-fapshi-refund", () => ({ triggerAutomatedRefund: (...a: unknown[]) => triggerAutomatedRefund(...a) }));
vi.mock("@/lib/notifications/dispatch", () => ({
  scheduleInAppNotifications: (...a: unknown[]) => scheduleInAppNotifications(...a),
}));

import { processFapshiTransaction } from "@/lib/process-fapshi-transaction";

const baseAttempt = {
  id: "pa-1",
  transId: "tx-1",
  contributionId: "contrib-1",
  fineId: null,
  payerPhone: "677123456",
  amount: 2600,
  refundAttempts: 0,
};

describe("processFapshiTransaction — contribution duplicate detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    txQueryRaw.mockResolvedValue(undefined);
  });

  it("settles the winning contribution and marks the attempt SUCCESSFUL", async () => {
    findUniquePaymentAttempt.mockResolvedValue(baseAttempt);
    getPaymentStatus.mockResolvedValue({ status: "SUCCESSFUL", dateConfirmed: "2026-01-01T00:00:00Z" });
    txFindUniqueContribution.mockResolvedValue({ id: "contrib-1", status: "PENDING", fapshiTxRef: null });
    txUpdateContribution.mockResolvedValue({});
    findUniqueContribution.mockResolvedValue({ id: "contrib-1", membershipSlot: { beneficiaryName: "John" }, paidByUser: null });

    const result = await processFapshiTransaction("tx-1", "http://x");

    expect(result).toEqual({ status: "SUCCESSFUL" });
    expect(settleContribution).toHaveBeenCalledTimes(1);
    expect(txUpdateContribution).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PAID", fapshiTxRef: "tx-1" }) }),
    );
    expect(updatePaymentAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "SUCCESSFUL" } }),
    );
    expect(triggerAutomatedRefund).not.toHaveBeenCalled();
  });

  it("returns alreadyProcessed without re-settling when the same transId already settled it", async () => {
    findUniquePaymentAttempt.mockResolvedValue(baseAttempt);
    getPaymentStatus.mockResolvedValue({ status: "SUCCESSFUL", dateConfirmed: null });
    txFindUniqueContribution.mockResolvedValue({ id: "contrib-1", status: "PAID", fapshiTxRef: "tx-1" });

    const result = await processFapshiTransaction("tx-1", "http://x");

    expect(result).toEqual({ status: "SUCCESSFUL", alreadyProcessed: true });
    expect(settleContribution).not.toHaveBeenCalled();
    expect(triggerAutomatedRefund).not.toHaveBeenCalled();
  });

  it("flags a second successful transaction for an already-PAID slot as a duplicate and triggers a refund", async () => {
    findUniquePaymentAttempt.mockResolvedValue(baseAttempt);
    getPaymentStatus.mockResolvedValue({ status: "SUCCESSFUL", dateConfirmed: null });
    // A DIFFERENT transId already settled this contribution.
    txFindUniqueContribution.mockResolvedValue({ id: "contrib-1", status: "PAID", fapshiTxRef: "tx-OTHER" });
    findFirstMembershipSlot.mockResolvedValue({ beneficiaryName: "John Doe" });

    const result = await processFapshiTransaction("tx-1", "http://x");

    expect(result).toEqual({ status: "SUCCESSFUL", duplicate: true });
    expect(settleContribution).not.toHaveBeenCalled();
    expect(updatePaymentAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "DUPLICATE_PAID",
          refundReason: "Refund: Duplicate payment detected for slot John Doe",
        }),
      }),
    );
    expect(triggerAutomatedRefund).toHaveBeenCalledWith("pa-1");
  });

  it("falls back to legacy match-by-fapshiTxRef when no PaymentAttempt row exists", async () => {
    findUniquePaymentAttempt.mockResolvedValue(null);
    getPaymentStatus.mockResolvedValue({ status: "SUCCESSFUL", dateConfirmed: null });
    findUniqueContribution.mockResolvedValue({ id: "contrib-legacy", status: "PENDING" });

    const result = await processFapshiTransaction("tx-legacy", "http://x");

    expect(result).toEqual({ status: "SUCCESSFUL" });
    expect(settleContribution).toHaveBeenCalledTimes(1);
  });

  it("marks a FAILED transaction's contribution FAILED and notifies the member", async () => {
    findUniquePaymentAttempt.mockResolvedValue(baseAttempt);
    getPaymentStatus.mockResolvedValue({ status: "FAILED", reason: "insufficient funds" });
    findUniqueContribution.mockResolvedValue({
      id: "contrib-1",
      status: "PENDING",
      amountPaid: 2500,
      feePaid: 100,
      finePaid: 0,
      membershipSlot: {
        membership: {
          userId: "user-1",
          tontineSessionId: "session-1",
          tontineSession: { type: "HEBDO_SUNDAY", title: null },
        },
      },
    });

    const result = await processFapshiTransaction("tx-1", "http://x");

    expect(result).toEqual({ status: "FAILED", failureReason: "insufficient funds" });
    expect(updateContribution).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "FAILED", failureReason: "insufficient funds" } }),
    );
    expect(scheduleInAppNotifications).toHaveBeenCalled();
    expect(updateManyPaymentAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ where: { transId: "tx-1", status: "PENDING" }, data: { status: "FAILED" } }),
    );
  });
});
