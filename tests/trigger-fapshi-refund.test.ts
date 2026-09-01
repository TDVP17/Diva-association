import { describe, it, expect, vi, beforeEach } from "vitest";

const findUniquePaymentAttempt = vi.fn();
const updatePaymentAttempt = vi.fn();
const findUniqueContribution = vi.fn();
const findUniqueFine = vi.fn();
const findManyUser = vi.fn();

const initiatePayout = vi.fn();
const isPayoutConfigured = vi.fn();
const sendWhatsAppMessageSafe = vi.fn();
const scheduleInAppNotifications = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    paymentAttempt: {
      findUnique: (...a: unknown[]) => findUniquePaymentAttempt(...a),
      update: (...a: unknown[]) => updatePaymentAttempt(...a),
    },
    contribution: { findUnique: (...a: unknown[]) => findUniqueContribution(...a) },
    fine: { findUnique: (...a: unknown[]) => findUniqueFine(...a) },
    user: { findMany: (...a: unknown[]) => findManyUser(...a) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  },
}));
vi.mock("@/lib/fapshi", () => ({
  initiatePayout: (...a: unknown[]) => initiatePayout(...a),
  isPayoutConfigured: (...a: unknown[]) => isPayoutConfigured(...a),
  FapshiError: class FapshiError extends Error {},
}));
vi.mock("@/lib/whatsapp/evolution", () => ({
  sendWhatsAppMessageSafe: (...a: unknown[]) => sendWhatsAppMessageSafe(...a),
}));
vi.mock("@/lib/notifications/dispatch", () => ({
  scheduleInAppNotifications: (...a: unknown[]) => scheduleInAppNotifications(...a),
}));

import { triggerAutomatedRefund } from "@/lib/trigger-fapshi-refund";

const baseAttempt = {
  id: "pa-1",
  transId: "tx-1",
  contributionId: "contrib-1",
  fineId: null,
  payerPhone: "677123456",
  amount: 2600,
  status: "DUPLICATE_PAID",
  refundReason: "Refund: Duplicate payment detected for slot John Doe",
  refundAttempts: 0,
};

const contributionInclude = {
  id: "contrib-1",
  membershipSlot: { beneficiaryName: "John Doe", membership: { user: { preferredLang: "fr" } } },
  paidByUser: null,
};

describe("triggerAutomatedRefund", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUniqueContribution.mockResolvedValue(contributionInclude);
    findManyUser.mockResolvedValue([{ id: "admin-1" }]);
  });

  it("is a no-op if the attempt isn't currently DUPLICATE_PAID", async () => {
    findUniquePaymentAttempt.mockResolvedValue({ ...baseAttempt, status: "REFUNDED" });

    await triggerAutomatedRefund("pa-1");

    expect(isPayoutConfigured).not.toHaveBeenCalled();
    expect(updatePaymentAttempt).not.toHaveBeenCalled();
  });

  it("escalates immediately to manual review when the payout service isn't configured", async () => {
    findUniquePaymentAttempt.mockResolvedValue(baseAttempt);
    isPayoutConfigured.mockReturnValue(false);

    await triggerAutomatedRefund("pa-1");

    expect(initiatePayout).not.toHaveBeenCalled();
    expect(updatePaymentAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "REFUND_FAILED_MANUAL_REVIEW" }) }),
    );
    expect(scheduleInAppNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ type: "PAYMENT_REFUND_ESCALATED" }),
    );
  });

  it("refunds successfully and notifies the payer via WhatsApp in their language", async () => {
    findUniquePaymentAttempt.mockResolvedValue(baseAttempt);
    isPayoutConfigured.mockReturnValue(true);
    initiatePayout.mockResolvedValue({ transId: "refund-tx-1", message: "ok", dateInitiated: "now" });

    await triggerAutomatedRefund("pa-1");

    expect(updatePaymentAttempt).toHaveBeenNthCalledWith(1, expect.objectContaining({ data: { status: "REFUND_INITIATED" } }));
    expect(updatePaymentAttempt).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ data: expect.objectContaining({ status: "REFUNDED", refundTransId: "refund-tx-1" }) }),
    );
    expect(sendWhatsAppMessageSafe).toHaveBeenCalledWith("677123456", expect.stringContaining("remboursé"));
  });

  it("requeues with backoff on a failure below the 3-attempt limit", async () => {
    findUniquePaymentAttempt.mockResolvedValue(baseAttempt); // refundAttempts: 0
    isPayoutConfigured.mockReturnValue(true);
    initiatePayout.mockRejectedValue(new Error("network blip"));

    await triggerAutomatedRefund("pa-1");

    expect(updatePaymentAttempt).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({ status: "DUPLICATE_PAID", refundAttempts: 1, lastRefundError: "network blip" }),
      }),
    );
    expect(scheduleInAppNotifications).not.toHaveBeenCalled();
  });

  it("escalates to manual review after the 3rd failed attempt", async () => {
    findUniquePaymentAttempt.mockResolvedValue({ ...baseAttempt, refundAttempts: 2 });
    isPayoutConfigured.mockReturnValue(true);
    initiatePayout.mockRejectedValue(new Error("payout declined"));

    await triggerAutomatedRefund("pa-1");

    expect(updatePaymentAttempt).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({ status: "REFUND_FAILED_MANUAL_REVIEW", refundAttempts: 3 }),
      }),
    );
    expect(scheduleInAppNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ type: "PAYMENT_REFUND_ESCALATED" }),
    );
  });
});
