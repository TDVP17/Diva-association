import { describe, it, expect, vi, beforeEach } from "vitest";

const authMock = vi.fn();
vi.mock("@/auth", () => ({
  auth: (...a: unknown[]) => authMock(...a),
}));

const sessionFindUnique = vi.fn();
const slotFindMany = vi.fn();
const slotCountMock = vi.fn();
const membershipFindUnique = vi.fn();

const txSlotFindMany = vi.fn();
const txSlotUpdate = vi.fn();
const txSlotCreateMany = vi.fn();
const txSlotDeleteMany = vi.fn();
const txSlotDelete = vi.fn();
const txMembershipUpdate = vi.fn();
const txSessionUpdate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tontineSession: { findUnique: (...a: unknown[]) => sessionFindUnique(...a) },
    membershipSlot: {
      findMany: (...a: unknown[]) => slotFindMany(...a),
      count: (...a: unknown[]) => slotCountMock(...a),
    },
    membership: { findUnique: (...a: unknown[]) => membershipFindUnique(...a) },
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        membershipSlot: {
          findMany: (...a: unknown[]) => txSlotFindMany(...a),
          update: (...a: unknown[]) => txSlotUpdate(...a),
          createMany: (...a: unknown[]) => txSlotCreateMany(...a),
          deleteMany: (...a: unknown[]) => txSlotDeleteMany(...a),
          delete: (...a: unknown[]) => txSlotDelete(...a),
        },
        membership: {
          update: (...a: unknown[]) => txMembershipUpdate(...a),
        },
        tontineSession: {
          update: (...a: unknown[]) => txSessionUpdate(...a),
        },
      }),
  },
}));

import { POST } from "@/app/api/sessions/[id]/slots/route";

function makeReq(body: unknown) {
  return {
    json: async () => body,
    headers: new Headers(),
  } as unknown as Request;
}

describe("POST /api/sessions/[id]/slots — renaming names after cotisation started", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "member-1", role: "MEMBER" } });
  });

  it("allows a member in an ACTIVE cotisation to rename their existing slots by exact slotIds without swapping positions", async () => {
    // Future startDate + 10 positions ensures isSessionCycleFinished === false
    sessionFindUnique.mockResolvedValue({
      id: "session-active",
      status: "ACTIVE",
      type: "HEBDO_SUNDAY",
      startDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      maxSlots: 10,
      memberships: [
        { id: "mem-1", status: "APPROVED", slotCount: 2 },
        { id: "mem-2", status: "APPROVED", slotCount: 8 },
      ],
    });

    // First findMany: allSlots (for isSessionCycleFinished), second findMany: existingSlots (other members)
    slotFindMany
      .mockResolvedValueOnce(
        Array.from({ length: 10 }, (_, i) => ({ officialPosition: i + 1 })),
      )
      .mockResolvedValueOnce([{ beneficiaryName: "Alice" }, { beneficiaryName: "Stella" }]);

    membershipFindUnique.mockResolvedValue({
      id: "mem-1",
      userId: "member-1",
      tontineSessionId: "session-active",
      status: "APPROVED",
      slotCount: 2,
    });

    slotCountMock.mockResolvedValue(2);

    // Note: createdAt order has Zoe (#2) first and Amina (#7) second,
    // while UI sends alphabetical order: slot-amina (#7) then slot-zoe (#2).
    txSlotFindMany.mockResolvedValue([
      { id: "slot-zoe", beneficiaryName: "Zoe", officialPosition: 2, ballDrawn: 2 },
      { id: "slot-amina", beneficiaryName: "Amina", officialPosition: 7, ballDrawn: 7 },
    ]);

    const res = await POST(
      makeReq({
        slotCount: 2,
        beneficiaryNames: ["Amina Maman", "Stella"],
        slotIds: ["slot-amina", "slot-zoe"],
      }),
      { params: Promise.resolve({ id: "session-active" }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    // "Stella" collides with another member's slot, so resolveUniqueSlotNames turns it into "Stella2"
    expect(body).toEqual({
      ok: true,
      beneficiaryNames: ["Amina Maman", "Stella2"],
    });

    // Must update each slot by its exact slotId, preserving officialPosition & ballDrawn untouched
    expect(txSlotUpdate).toHaveBeenCalledTimes(2);
    expect(txSlotUpdate).toHaveBeenNthCalledWith(1, {
      where: { id: "slot-amina" },
      data: { beneficiaryName: "Amina Maman" },
    });
    expect(txSlotUpdate).toHaveBeenNthCalledWith(2, {
      where: { id: "slot-zoe" },
      data: { beneficiaryName: "Stella2" },
    });
    expect(txSlotCreateMany).not.toHaveBeenCalled();
    expect(txSlotDeleteMany).not.toHaveBeenCalled();
    expect(txSlotDelete).not.toHaveBeenCalled();
  });

  it("blocks a member in an ACTIVE cotisation from adding or removing slots (admin only)", async () => {
    sessionFindUnique.mockResolvedValue({
      id: "session-active",
      status: "ACTIVE",
      type: "HEBDO_SUNDAY",
      startDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      maxSlots: 15,
      memberships: [{ id: "mem-1", status: "APPROVED", slotCount: 2 }],
    });
    slotFindMany.mockResolvedValueOnce([{ officialPosition: 1 }, { officialPosition: 2 }]);
    membershipFindUnique.mockResolvedValue({
      id: "mem-1",
      userId: "member-1",
      tontineSessionId: "session-active",
      status: "APPROVED",
      slotCount: 2,
    });
    slotCountMock.mockResolvedValue(2);

    // Attempt to add a 3rd slot
    const resAdd = await POST(
      makeReq({
        slotCount: 3,
        beneficiaryNames: ["Nom 1", "Nom 2", "Nouveau Nom"],
        slotIds: ["slot-1", "slot-2", null],
      }),
      { params: Promise.resolve({ id: "session-active" }) },
    );
    expect(resAdd.status).toBe(409);

    // Attempt to remove down to 1 slot
    slotFindMany.mockResolvedValueOnce([{ officialPosition: 1 }, { officialPosition: 2 }]);
    const resRemove = await POST(
      makeReq({
        slotCount: 1,
        beneficiaryNames: ["Nom 1"],
        slotIds: ["slot-1"],
      }),
      { params: Promise.resolve({ id: "session-active" }) },
    );
    expect(resRemove.status).toBe(409);

    expect(txSlotUpdate).not.toHaveBeenCalled();
    expect(txSlotCreateMany).not.toHaveBeenCalled();
    expect(txSlotDeleteMany).not.toHaveBeenCalled();
  });

  it("still allows initial one-time slot selection when slotCount is null in an ACTIVE cotisation and ranks at the end", async () => {
    sessionFindUnique.mockResolvedValue({
      id: "session-active",
      status: "ACTIVE",
      type: "HEBDO_SUNDAY",
      startDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      maxSlots: 5,
      memberships: [
        { id: "mem-late", status: "APPROVED", slotCount: null },
        { id: "mem-other", status: "APPROVED", slotCount: 5 },
      ],
    });
    slotFindMany
      .mockResolvedValueOnce(
        Array.from({ length: 5 }, (_, i) => ({ officialPosition: i + 1 })),
      )
      .mockResolvedValueOnce([{ beneficiaryName: "Alice" }]);

    membershipFindUnique.mockResolvedValue({
      id: "mem-late",
      userId: "member-1",
      tontineSessionId: "session-active",
      status: "APPROVED",
      slotCount: null,
    });

    // Inside transaction: 1st findMany = existingUserSlots ([]), 2nd findMany = currentApprovedSlots (5)
    txSlotFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(
        Array.from({ length: 5 }, (_, i) => ({ officialPosition: i + 1 })),
      );

    const res = await POST(
      makeReq({
        slotCount: 2,
        beneficiaryNames: ["Clarisse 1", "Clarisse 2"],
      }),
      { params: Promise.resolve({ id: "session-active" }) },
    );

    expect(res.status).toBe(200);
    expect(txSlotCreateMany).toHaveBeenCalledWith({
      data: [
        {
          membershipId: "mem-late",
          beneficiaryName: "Clarisse 1",
          officialPosition: 6,
          ballDrawn: 6,
        },
        {
          membershipId: "mem-late",
          beneficiaryName: "Clarisse 2",
          officialPosition: 7,
          ballDrawn: 7,
        },
      ],
    });
    expect(txSessionUpdate).toHaveBeenCalledWith({
      where: { id: "session-active" },
      data: { maxSlots: 7 },
    });
    expect(txMembershipUpdate).toHaveBeenCalledWith({
      where: { id: "mem-late" },
      data: { slotCount: 2 },
    });
  });
});
