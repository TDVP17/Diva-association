import { describe, it, expect, vi, beforeEach } from "vitest";

const requireAdmin = vi.fn();
vi.mock("@/lib/require-admin", () => ({
  requireAdmin: (...a: unknown[]) => requireAdmin(...a),
}));

const sessionFindUnique = vi.fn();
const userFindUnique = vi.fn();
const membershipFindUnique = vi.fn();
const slotFindMany = vi.fn();

const txSlotFindMany = vi.fn();
const txSlotDeleteMany = vi.fn();
const txSlotCount = vi.fn();
const txSlotCreateMany = vi.fn();
const txMembershipCreate = vi.fn();
const txMembershipUpdate = vi.fn();
const txKycUpdateMany = vi.fn();
const txSessionUpdate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tontineSession: { findUnique: (...a: unknown[]) => sessionFindUnique(...a) },
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
    membership: { findUnique: (...a: unknown[]) => membershipFindUnique(...a) },
    membershipSlot: { findMany: (...a: unknown[]) => slotFindMany(...a) },
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        membershipSlot: {
          findMany: (...a: unknown[]) => txSlotFindMany(...a),
          deleteMany: (...a: unknown[]) => txSlotDeleteMany(...a),
          count: (...a: unknown[]) => txSlotCount(...a),
          createMany: (...a: unknown[]) => txSlotCreateMany(...a),
        },
        membership: {
          create: (...a: unknown[]) => txMembershipCreate(...a),
          update: (...a: unknown[]) => txMembershipUpdate(...a),
        },
        kycVerification: {
          updateMany: (...a: unknown[]) => txKycUpdateMany(...a),
        },
        tontineSession: {
          update: (...a: unknown[]) => txSessionUpdate(...a),
        },
      }),
  },
}));

vi.mock("@/lib/unsettled-fines-gate", () => ({
  checkUserFinesForJoining: vi.fn().mockResolvedValue({
    canJoin: true,
    unpaidFinesCount: 0,
    totalUnpaidAmount: 0,
    blockingSessions: [],
  }),
}));

vi.mock("@/lib/member-code", () => ({
  ensureMemberCode: vi.fn().mockResolvedValue("DIVA-001"),
}));

vi.mock("@/lib/notifications/dispatch", () => ({
  scheduleInAppNotifications: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

import { POST } from "@/app/api/admin/memberships/manual/route";

function makeReq(body: unknown) {
  return {
    json: async () => body,
    headers: new Headers(),
  } as unknown as Request;
}

describe("POST /api/admin/memberships/manual — adding names after cotisation started", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdmin.mockResolvedValue({ user: { id: "admin-1", role: "PRESIDENT" } });
    userFindUnique.mockResolvedValue({
      id: "user-new",
      name: "Marie Claire",
      role: "MEMBER",
      isBanned: false,
      preferredLang: "fr",
    });
  });

  it("allows adding a new member to an ACTIVE cotisation and ranks their names strictly at the end", async () => {
    sessionFindUnique.mockResolvedValue({
      status: "ACTIVE",
      title: "Chaque dimanche",
      type: "WEEKLY_SUN",
      maxSlots: 10,
    });
    membershipFindUnique.mockResolvedValue(null);
    slotFindMany.mockResolvedValue([{ beneficiaryName: "Alice" }, { beneficiaryName: "Bob" }]);
    txSlotFindMany.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({ id: `slot-${i + 1}`, officialPosition: i + 1 })),
    );
    txMembershipCreate.mockResolvedValue({ id: "mem-new", slotCount: 2 });

    const res = await POST(
      makeReq({
        userId: "user-new",
        tontineSessionId: "session-active",
        slotCount: 2,
        beneficiaryNames: ["Marie 1", "Marie 2"],
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      beneficiaryNames: ["Marie 1", "Marie 2"],
      assignedPositions: [11, 12],
      isAppend: false,
    });

    expect(txSlotCreateMany).toHaveBeenCalledWith({
      data: [
        { membershipId: "mem-new", beneficiaryName: "Marie 1", officialPosition: 11, ballDrawn: 11 },
        { membershipId: "mem-new", beneficiaryName: "Marie 2", officialPosition: 12, ballDrawn: 12 },
      ],
    });
    expect(txSessionUpdate).toHaveBeenCalledWith({
      where: { id: "session-active" },
      data: { maxSlots: 12 },
    });
  });

  it("appends additional names at the end for an already-approved member without touching existing slots", async () => {
    sessionFindUnique.mockResolvedValue({
      status: "DRAWING",
      title: "Chaque dimanche",
      type: "WEEKLY_SUN",
      maxSlots: null,
    });
    membershipFindUnique.mockResolvedValue({
      id: "mem-existing",
      userId: "user-new",
      tontineSessionId: "session-drawing",
      status: "APPROVED",
      slotCount: 1,
    });
    slotFindMany.mockResolvedValue([{ beneficiaryName: "Marie" }, { beneficiaryName: "Stella" }]);
    txSlotFindMany.mockResolvedValue([
      { id: "slot-1", officialPosition: 1 },
      { id: "slot-2", officialPosition: 2 },
    ]);
    txSlotCount.mockResolvedValue(1);
    txMembershipUpdate.mockResolvedValue({ id: "mem-existing", slotCount: 2 });

    const res = await POST(
      makeReq({
        userId: "user-new",
        tontineSessionId: "session-drawing",
        slotCount: 1,
        beneficiaryNames: ["Marie"],
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      beneficiaryNames: ["Marie2"],
      assignedPositions: [3],
      isAppend: true,
    });

    expect(txSlotDeleteMany).not.toHaveBeenCalled();
    expect(txMembershipUpdate).toHaveBeenCalledWith({
      where: { id: "mem-existing" },
      data: { status: "APPROVED", rejectionReason: null, slotCount: 2 },
    });
    expect(txSlotCreateMany).toHaveBeenCalledWith({
      data: [
        { membershipId: "mem-existing", beneficiaryName: "Marie2", officialPosition: 3, ballDrawn: 3 },
      ],
    });
  });

  it("blocks adding names when the cotisation is CLOSED", async () => {
    sessionFindUnique.mockResolvedValue({
      status: "CLOSED",
      title: "Ancienne cotisation",
      type: "WEEKLY_SUN",
      maxSlots: null,
    });

    const res = await POST(
      makeReq({
        userId: "user-new",
        tontineSessionId: "session-closed",
        slotCount: 1,
        beneficiaryNames: ["Marie"],
      }),
    );

    expect(res.status).toBe(409);
    expect(txSlotCreateMany).not.toHaveBeenCalled();
  });
});
