import { describe, it, expect, vi, beforeEach } from "vitest";

const requireAdmin = vi.fn();
vi.mock("@/lib/require-admin", () => ({ requireAdmin: (...a: unknown[]) => requireAdmin(...a) }));

const sessionFindUnique = vi.fn();
const userFindFirst = vi.fn();
const slotFindMany = vi.fn();
const txMembershipFindUnique = vi.fn();
const txMembershipCreate = vi.fn();
const txMembershipUpdate = vi.fn();
const txSlotUpdate = vi.fn();
const transaction = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tontineSession: { findUnique: (...a: unknown[]) => sessionFindUnique(...a) },
    user: { findFirst: (...a: unknown[]) => userFindFirst(...a) },
    membershipSlot: { findMany: (...a: unknown[]) => slotFindMany(...a) },
    $transaction: (fn: (tx: unknown) => unknown) => fn({
      membership: {
        findUnique: (...a: unknown[]) => txMembershipFindUnique(...a),
        create: (...a: unknown[]) => txMembershipCreate(...a),
        update: (...a: unknown[]) => txMembershipUpdate(...a),
      },
      membershipSlot: {
        update: (...a: unknown[]) => txSlotUpdate(...a),
      },
    }),
  },
}));

const scheduleInAppNotifications = vi.fn();
vi.mock("@/lib/notifications/dispatch", () => ({
  scheduleInAppNotifications: (...a: unknown[]) => scheduleInAppNotifications(...a),
}));

const logAudit = vi.fn();
vi.mock("@/lib/audit", () => ({
  logAudit: (...a: unknown[]) => logAudit(...a),
}));

import { POST } from "@/app/api/admin/sessions/[id]/transfer-slots/route";

function makeReq(body: unknown) {
  return { json: async () => body } as unknown as Request;
}

describe("POST /api/admin/sessions/[id]/transfer-slots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdmin.mockResolvedValue({ user: { id: "admin-1", role: "PRESIDENT" } });
    sessionFindUnique.mockResolvedValue({
      id: "session-1",
      title: "Tontine Hebdo",
      type: "HEBDO_SUNDAY",
      status: "ACTIVE",
    });
  });

  it("returns 403 if caller is not an admin", async () => {
    requireAdmin.mockResolvedValue(null);
    const res = await POST(makeReq({ slotIds: ["slot-1"], targetEmail: "cousin@gmail.com" }), {
      params: Promise.resolve({ id: "session-1" }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 if session does not exist", async () => {
    sessionFindUnique.mockResolvedValue(null);
    const res = await POST(makeReq({ slotIds: ["slot-1"], targetEmail: "cousin@gmail.com" }), {
      params: Promise.resolve({ id: "session-999" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 with helpful message if target user does not exist", async () => {
    userFindFirst.mockResolvedValue(null);
    const res = await POST(makeReq({ slotIds: ["slot-1"], targetEmail: "unknown@gmail.com" }), {
      params: Promise.resolve({ id: "session-1" }),
    });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain("Aucun compte n'a été trouvé avec l'email");
  });

  it("returns 400 if target user is banned", async () => {
    userFindFirst.mockResolvedValue({
      id: "cousin-id",
      name: "Cousine Marie",
      email: "cousin@gmail.com",
      role: "MEMBER",
      isBanned: true,
    });
    const res = await POST(makeReq({ slotIds: ["slot-1"], targetEmail: "cousin@gmail.com" }), {
      params: Promise.resolve({ id: "session-1" }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("banni");
  });

  it("transfers slots cleanly to cousin when cousin does not yet have a membership", async () => {
    userFindFirst.mockResolvedValue({
      id: "cousin-id",
      name: "Cousine Marie",
      email: "cousin@gmail.com",
      role: "MEMBER",
      isBanned: false,
    });

    slotFindMany.mockResolvedValue([
      {
        id: "slot-cousin-1",
        membershipId: "mem-creator",
        beneficiaryName: "Valent2",
        officialPosition: 2,
        ballDrawn: 2,
        membership: {
          tontineSessionId: "session-1",
          userId: "creator-id",
          user: { id: "creator-id", name: "Tilong Valentine", email: "creator@gmail.com" },
        },
      },
      {
        id: "slot-cousin-2",
        membershipId: "mem-creator",
        beneficiaryName: "Valent3",
        officialPosition: 4,
        ballDrawn: 4,
        membership: {
          tontineSessionId: "session-1",
          userId: "creator-id",
          user: { id: "creator-id", name: "Tilong Valentine", email: "creator@gmail.com" },
        },
      },
    ]);

    // Target does not have a membership yet
    txMembershipFindUnique
      .mockResolvedValueOnce(null) // targetMembership check
      .mockResolvedValueOnce({ slotCount: 4 }); // source membership check (had 4 slots)

    txMembershipCreate.mockResolvedValue({
      id: "mem-cousin",
      userId: "cousin-id",
      tontineSessionId: "session-1",
      status: "APPROVED",
      slotCount: 2,
    });

    const res = await POST(
      makeReq({
        slotIds: ["slot-cousin-1", "slot-cousin-2"],
        targetEmail: "cousin@gmail.com",
        newBeneficiaryNames: {
          "slot-cousin-1": "Marie Part 1",
          "slot-cousin-2": "Marie Part 2",
        },
      }),
      { params: Promise.resolve({ id: "session-1" }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.transferredCount).toBe(2);

    // Verified target membership was created as APPROVED with 2 slots
    expect(txMembershipCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "cousin-id",
        tontineSessionId: "session-1",
        status: "APPROVED",
        slotCount: 2,
      }),
    });

    // Verified source membership was decremented from 4 to 2 (4 - 2)
    expect(txMembershipUpdate).toHaveBeenCalledWith({
      where: { id: "mem-creator" },
      data: { slotCount: 2 },
    });

    // Verified both slots updated to point to cousin's membership and renamed
    expect(txSlotUpdate).toHaveBeenCalledWith({
      where: { id: "slot-cousin-1" },
      data: { membershipId: "mem-cousin", beneficiaryName: "Marie Part 1" },
    });
    expect(txSlotUpdate).toHaveBeenCalledWith({
      where: { id: "slot-cousin-2" },
      data: { membershipId: "mem-cousin", beneficiaryName: "Marie Part 2" },
    });

    // Verified audit log
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "TRANSFER_MEMBERSHIP_SLOTS",
        tontineSessionId: "session-1",
      }),
    );

    // Verified notifications dispatched to both cousin and creator
    expect(scheduleInAppNotifications).toHaveBeenCalledTimes(2);
  });
});

