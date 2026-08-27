import { describe, it, expect, vi, beforeEach } from "vitest";

const auth = vi.fn();
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => auth(...a) }));

const findUnique = vi.fn();
const updateMany = vi.fn();
const findUniqueOrThrow = vi.fn();
const userFindMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    positionSwapRequest: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      updateMany: (...a: unknown[]) => updateMany(...a),
      findUniqueOrThrow: (...a: unknown[]) => findUniqueOrThrow(...a),
    },
    user: { findMany: (...a: unknown[]) => userFindMany(...a) },
  },
}));

const scheduleInAppNotifications = vi.fn();
vi.mock("@/lib/notifications/dispatch", () => ({
  scheduleInAppNotifications: (...a: unknown[]) => scheduleInAppNotifications(...a),
}));

import { POST } from "@/app/api/chat/swap-requests/[id]/respond/route";

function fakeRequest(body: unknown) {
  return { json: async () => body } as unknown as Request;
}

const baseRequest = {
  id: "swap-1",
  requesterId: "requester-1",
  targetId: "target-1",
  tontineSessionId: "session-1",
  status: "PENDING_MEMBERSHIP",
};

describe("POST /api/chat/swap-requests/[id]/respond", () => {
  beforeEach(() => {
    auth.mockReset();
    findUnique.mockReset();
    updateMany.mockReset();
    findUniqueOrThrow.mockReset();
    userFindMany.mockReset();
    scheduleInAppNotifications.mockReset();
    auth.mockResolvedValue({ user: { id: "target-1" } });
  });

  it("409s when the atomic updateMany finds the request already resolved — the actual race-condition guard", async () => {
    findUnique.mockResolvedValue(baseRequest);
    updateMany.mockResolvedValue({ count: 0 });

    const res = await POST(fakeRequest({ action: "accept" }), { params: Promise.resolve({ id: "swap-1" }) });
    expect(res.status).toBe(409);
    expect(findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("accepts, moves to PENDING_ADMIN, and notifies every admin/president user", async () => {
    findUnique.mockResolvedValue(baseRequest);
    updateMany.mockResolvedValue({ count: 1 });
    findUniqueOrThrow.mockResolvedValue({
      ...baseRequest,
      status: "PENDING_ADMIN",
      tontineSession: { type: "HEBDO_SUNDAY" },
      createdAt: new Date("2026-01-01"),
    });
    userFindMany.mockResolvedValue([{ id: "admin-1" }, { id: "admin-2" }]);

    const res = await POST(fakeRequest({ action: "accept" }), { params: Promise.resolve({ id: "swap-1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("PENDING_ADMIN");
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "swap-1", status: "PENDING_MEMBERSHIP" },
      data: { status: "PENDING_ADMIN" },
    });
    expect(scheduleInAppNotifications).toHaveBeenCalledTimes(1);
    const call = scheduleInAppNotifications.mock.calls[0][0];
    expect(call.type).toBe("SWAP_REQUEST_PENDING_ADMIN");
    expect(call.recipients.map((r: { userId: string }) => r.userId).sort()).toEqual(["admin-1", "admin-2"]);
  });

  it("declines without notifying admins", async () => {
    findUnique.mockResolvedValue(baseRequest);
    updateMany.mockResolvedValue({ count: 1 });
    findUniqueOrThrow.mockResolvedValue({
      ...baseRequest,
      status: "REJECTED",
      tontineSession: { type: "HEBDO_SUNDAY" },
      createdAt: new Date("2026-01-01"),
    });

    const res = await POST(fakeRequest({ action: "decline" }), { params: Promise.resolve({ id: "swap-1" }) });
    expect(res.status).toBe(200);
    expect(userFindMany).not.toHaveBeenCalled();
    expect(scheduleInAppNotifications).not.toHaveBeenCalled();
  });

  it("403s when the caller isn't the target member", async () => {
    auth.mockResolvedValue({ user: { id: "someone-else" } });
    findUnique.mockResolvedValue(baseRequest);

    const res = await POST(fakeRequest({ action: "accept" }), { params: Promise.resolve({ id: "swap-1" }) });
    expect(res.status).toBe(403);
    expect(updateMany).not.toHaveBeenCalled();
  });
});
