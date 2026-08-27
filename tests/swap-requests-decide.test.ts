import { describe, it, expect, vi, beforeEach } from "vitest";

const requireAdmin = vi.fn();
vi.mock("@/lib/require-admin", () => ({ requireAdmin: (...a: unknown[]) => requireAdmin(...a) }));

const findUnique = vi.fn();
const txUpdateMany = vi.fn();
const txMembershipFindUnique = vi.fn();
const txSlotUpdate = vi.fn();
const transaction = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    positionSwapRequest: { findUnique: (...a: unknown[]) => findUnique(...a) },
    $transaction: (...a: unknown[]) => transaction(...a),
  },
}));

const scheduleInAppNotifications = vi.fn();
vi.mock("@/lib/notifications/dispatch", () => ({
  scheduleInAppNotifications: (...a: unknown[]) => scheduleInAppNotifications(...a),
}));

import { POST } from "@/app/api/admin/swap-requests/[id]/decide/route";

function fakeRequest(body: unknown) {
  return { json: async () => body } as unknown as Request;
}

const tx = {
  positionSwapRequest: { updateMany: (...a: unknown[]) => txUpdateMany(...a) },
  membership: { findUnique: (...a: unknown[]) => txMembershipFindUnique(...a) },
  membershipSlot: { update: (...a: unknown[]) => txSlotUpdate(...a) },
};

const preCheckRow = {
  id: "swap-1",
  requesterId: "requester-1",
  targetId: "target-1",
  tontineSessionId: "session-1",
  status: "PENDING_ADMIN",
};

describe("POST /api/admin/swap-requests/[id]/decide", () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    findUnique.mockReset();
    txUpdateMany.mockReset();
    txMembershipFindUnique.mockReset();
    txSlotUpdate.mockReset();
    transaction.mockReset();
    scheduleInAppNotifications.mockReset();
    requireAdmin.mockResolvedValue({ user: { id: "admin-1" } });
    findUnique.mockResolvedValue(preCheckRow);
    transaction.mockImplementation((callback: (txArg: typeof tx) => Promise<unknown>) => callback(tx));
  });

  it("409s without touching membership/slot lookups when the row is no longer PENDING_ADMIN — the atomic claim aborts the transaction", async () => {
    txUpdateMany.mockResolvedValue({ count: 0 });

    const res = await POST(fakeRequest({ action: "approve" }), { params: Promise.resolve({ id: "swap-1" }) });
    expect(res.status).toBe(409);
    expect(txMembershipFindUnique).not.toHaveBeenCalled();
    expect(txSlotUpdate).not.toHaveBeenCalled();
    expect(scheduleInAppNotifications).not.toHaveBeenCalled();
  });

  it("reject claims the row but never looks up slots", async () => {
    txUpdateMany.mockResolvedValue({ count: 1 });

    const res = await POST(fakeRequest({ action: "reject" }), { params: Promise.resolve({ id: "swap-1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("REJECTED");
    expect(txMembershipFindUnique).not.toHaveBeenCalled();
    expect(scheduleInAppNotifications).toHaveBeenCalledTimes(1);
    expect(scheduleInAppNotifications.mock.calls[0][0].type).toBe("SWAP_REQUEST_REJECTED");
  });

  it("approve swaps both slots' positions only after a successful claim, then notifies both members", async () => {
    txUpdateMany.mockResolvedValue({ count: 1 });
    txMembershipFindUnique
      .mockResolvedValueOnce({ slots: [{ id: "slot-requester", officialPosition: 3, ballDrawn: 30 }] })
      .mockResolvedValueOnce({ slots: [{ id: "slot-target", officialPosition: 7, ballDrawn: 70 }] });

    const res = await POST(fakeRequest({ action: "approve" }), { params: Promise.resolve({ id: "swap-1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("APPROVED");
    expect(txSlotUpdate).toHaveBeenCalledTimes(2);
    expect(txSlotUpdate).toHaveBeenCalledWith({
      where: { id: "slot-requester" },
      data: { officialPosition: 7, ballDrawn: 70 },
    });
    expect(txSlotUpdate).toHaveBeenCalledWith({
      where: { id: "slot-target" },
      data: { officialPosition: 3, ballDrawn: 30 },
    });
    expect(scheduleInAppNotifications).toHaveBeenCalledTimes(1);
    const call = scheduleInAppNotifications.mock.calls[0][0];
    expect(call.type).toBe("SWAP_REQUEST_APPROVED");
    expect(call.recipients.map((r: { userId: string }) => r.userId).sort()).toEqual(["requester-1", "target-1"]);
  });

  it("404s when a member has no registered slot, inside the same transaction", async () => {
    txUpdateMany.mockResolvedValue({ count: 1 });
    txMembershipFindUnique.mockResolvedValueOnce({ slots: [] }).mockResolvedValueOnce({ slots: [] });

    const res = await POST(fakeRequest({ action: "approve" }), { params: Promise.resolve({ id: "swap-1" }) });
    expect(res.status).toBe(404);
    expect(txSlotUpdate).not.toHaveBeenCalled();
  });
});
