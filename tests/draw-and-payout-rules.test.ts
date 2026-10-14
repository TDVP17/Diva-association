import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockAuth,
  mockFindUniqueMembershipSlot,
  mockFindManyMembershipSlot,
  mockUpdateMembershipSlot,
  mockFindManyMembership,
  mockFindFirstMembership,
  mockCountContribution,
  mockCreatePayout,
  mockFindUniqueSession,
  mockGetDesignatedSlot,
  mockScheduleInAppNotifications,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockFindUniqueMembershipSlot: vi.fn(),
  mockFindManyMembershipSlot: vi.fn(),
  mockUpdateMembershipSlot: vi.fn(),
  mockFindManyMembership: vi.fn(),
  mockFindFirstMembership: vi.fn(),
  mockCountContribution: vi.fn(),
  mockCreatePayout: vi.fn(),
  mockFindUniqueSession: vi.fn(),
  mockGetDesignatedSlot: vi.fn(),
  mockScheduleInAppNotifications: vi.fn().mockResolvedValue(1),
}));

vi.mock("@/auth", () => ({
  auth: () => mockAuth(),
}));

vi.mock("@/lib/prisma", () => {
  const p: Record<string, unknown> = {
    membershipSlot: {
      findUnique: (...a: unknown[]) => mockFindUniqueMembershipSlot(...a),
      findMany: (...a: unknown[]) => mockFindManyMembershipSlot(...a),
      update: (...a: unknown[]) => mockUpdateMembershipSlot(...a),
    },
    membership: {
      findMany: (...a: unknown[]) => mockFindManyMembership(...a),
      findFirst: (...a: unknown[]) => mockFindFirstMembership(...a),
    },
    contribution: {
      count: (...a: unknown[]) => mockCountContribution(...a),
    },
    payout: {
      create: (...a: unknown[]) => mockCreatePayout(...a),
    },
    tontineSession: {
      findUnique: (...a: unknown[]) => mockFindUniqueSession(...a),
    },
  };
  p.$transaction = async (fn: (tx: typeof p) => Promise<unknown>) => fn(p);
  return { prisma: p };
});

vi.mock("@/lib/round-robin-lock", () => ({
  getDesignatedSlot: (...a: unknown[]) => mockGetDesignatedSlot(...a),
}));

vi.mock("@/lib/notifications/dispatch", () => ({
  scheduleInAppNotifications: (...a: unknown[]) => mockScheduleInAppNotifications(...a),
}));

import { POST as postPayoutClaim } from "@/app/api/payments/payout-claims/route";
import { GET as getPayoutOrder } from "@/app/api/sessions/[id]/payout-order/route";
import { POST as postDraw } from "@/app/api/sessions/[id]/draw/route";
import { isPayoutInfoUnlockTime } from "@/lib/tontine-engine";

describe("Draw and Payout Rules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/payments/payout-claims", () => {
    it("rejects with 409 if slot has not yet drawn its ball (ballDrawn === null)", async () => {
      mockAuth.mockResolvedValue({ user: { id: "user-1" } });
      mockFindUniqueMembershipSlot.mockResolvedValue({
        id: "slot-1",
        ballDrawn: null,
        membership: {
          userId: "user-1",
          tontineSessionId: "session-1",
          tontineSession: { type: "MONTHLY_28" },
        },
      });

      const req = new Request("http://localhost/api/payments/payout-claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          membershipSlotId: "slot-1",
          phone: "677123456",
          accountName: "John Doe",
        }),
      });

      const res = await postPayoutClaim(req);
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toContain("lucky ball");
    });

    it("rejects with 409 if less than half of members have contributed for this cycle", async () => {
      mockAuth.mockResolvedValue({ user: { id: "user-1" } });
      mockFindUniqueMembershipSlot.mockResolvedValue({
        id: "slot-1",
        ballDrawn: 1,
        membership: {
          userId: "user-1",
          tontineSessionId: "session-1",
          tontineSession: { type: "MONTHLY_28" },
        },
      });
      mockGetDesignatedSlot.mockResolvedValue({ id: "slot-1" });

      // 4 total slots in session -> half threshold is 2
      mockFindManyMembership.mockResolvedValue([
        { slots: [{ id: "slot-1" }, { id: "slot-2" }] },
        { slots: [{ id: "slot-3" }, { id: "slot-4" }] },
      ]);
      // Only 1 contribution paid so far (< 2)
      mockCountContribution.mockResolvedValue(1);

      const req = new Request("http://localhost/api/payments/payout-claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          membershipSlotId: "slot-1",
          phone: "677123456",
          accountName: "John Doe",
        }),
      });

      const res = await postPayoutClaim(req);
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toContain("half of the members have contributed");
    });

    it("accepts and creates payout claim if ball is drawn AND at least half have contributed", async () => {
      mockAuth.mockResolvedValue({ user: { id: "user-1" } });
      mockFindUniqueMembershipSlot.mockResolvedValue({
        id: "slot-1",
        ballDrawn: 1,
        membership: {
          userId: "user-1",
          tontineSessionId: "session-1",
          tontineSession: { type: "MONTHLY_28" },
        },
      });
      mockGetDesignatedSlot.mockResolvedValue({ id: "slot-1" });

      // 4 total slots -> half threshold is 2
      mockFindManyMembership.mockResolvedValue([
        { slots: [{ id: "slot-1" }, { id: "slot-2" }] },
        { slots: [{ id: "slot-3" }, { id: "slot-4" }] },
      ]);
      // 2 contributions paid (>= 2)
      mockCountContribution.mockResolvedValue(2);
      mockCreatePayout.mockResolvedValue({ id: "payout-1" });

      const req = new Request("http://localhost/api/payments/payout-claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          membershipSlotId: "slot-1",
          phone: "677123456",
          accountName: "John Doe",
        }),
      });

      const res = await postPayoutClaim(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.id).toBe("payout-1");
    });
  });

  describe("GET /api/sessions/[id]/payout-order", () => {
    it("returns userMustDrawFirst: true if the requesting user has undrawn slots", async () => {
      mockAuth.mockResolvedValue({ user: { id: "user-1" } });
      mockFindUniqueSession.mockResolvedValue({ type: "MONTHLY_28", startDate: new Date() });
      mockFindFirstMembership.mockResolvedValue({
        slots: [{ id: "slot-1", ballDrawn: null }],
      });

      const req = new Request("http://localhost/api/sessions/session-1/payout-order");
      const res = await getPayoutOrder(req, { params: Promise.resolve({ id: "session-1" }) });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.userMustDrawFirst).toBe(true);
      expect(data.rows).toEqual([]);
    });
  });

  describe("isPayoutInfoUnlockTime", () => {
    it("locks payout details before 18:30 Cameroon time (17:30 UTC) on due date", () => {
      // Due date: 2026-10-18
      const dueDate = new Date(Date.UTC(2026, 9, 18, 0, 0, 0));
      // At 18:29 Cameroon time = 17:29 UTC
      const before1830 = new Date(Date.UTC(2026, 9, 18, 17, 29, 0));
      expect(isPayoutInfoUnlockTime(dueDate, before1830)).toBe(false);
    });

    it("unlocks payout details at or after 18:30 Cameroon time (17:30 UTC) on due date", () => {
      const dueDate = new Date(Date.UTC(2026, 9, 18, 0, 0, 0));
      // At 18:30 Cameroon time = 17:30 UTC
      const at1830 = new Date(Date.UTC(2026, 9, 18, 17, 30, 0));
      expect(isPayoutInfoUnlockTime(dueDate, at1830)).toBe(true);

      // Later that evening (19:00 Cameroon = 18:00 UTC)
      const after1830 = new Date(Date.UTC(2026, 9, 18, 18, 0, 0));
      expect(isPayoutInfoUnlockTime(dueDate, after1830)).toBe(true);
    });
  });

  describe("POST /api/sessions/[id]/draw — multi-name drawing", () => {
    it("draws one slot at a time and returns remaining count and next slot name", async () => {
      mockAuth.mockResolvedValue({ user: { id: "user-1" } });
      mockFindUniqueSession.mockResolvedValue({
        id: "session-1",
        status: "ACTIVE",
        memberships: [
          {
            userId: "user-1",
            slots: [
              { id: "slot-1", beneficiaryName: "Marie Fotso", ballDrawn: null, officialPosition: 3 },
              { id: "slot-2", beneficiaryName: "Alice Fotso", ballDrawn: null, officialPosition: 7 },
            ],
          },
        ],
      });
      mockUpdateMembershipSlot.mockResolvedValue({ id: "slot-1", ballDrawn: 3 });

      // First draw (for Marie)
      const req1 = new Request("http://localhost/api/sessions/session-1/draw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotId: "slot-1" }),
      });
      const res1 = await postDraw(req1, { params: Promise.resolve({ id: "session-1" }) });
      expect(res1.status).toBe(200);
      const data1 = await res1.json();
      expect(data1.drawn).toEqual([{ slotId: "slot-1", beneficiaryName: "Marie Fotso", ballDrawn: 3 }]);
      expect(data1.remainingUndrawnCount).toBe(1);
      expect(data1.nextSlotName).toBe("Alice Fotso");

      // Second draw (for Alice)
      mockFindUniqueSession.mockResolvedValue({
        id: "session-1",
        status: "ACTIVE",
        memberships: [
          {
            userId: "user-1",
            slots: [
              { id: "slot-1", beneficiaryName: "Marie Fotso", ballDrawn: 3, officialPosition: 3 },
              { id: "slot-2", beneficiaryName: "Alice Fotso", ballDrawn: null, officialPosition: 7 },
            ],
          },
        ],
      });
      mockUpdateMembershipSlot.mockResolvedValue({ id: "slot-2", ballDrawn: 7 });

      const req2 = new Request("http://localhost/api/sessions/session-1/draw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotId: "slot-2" }),
      });
      const res2 = await postDraw(req2, { params: Promise.resolve({ id: "session-1" }) });
      expect(res2.status).toBe(200);
      const data2 = await res2.json();
      expect(data2.drawn).toEqual([{ slotId: "slot-2", beneficiaryName: "Alice Fotso", ballDrawn: 7 }]);
      expect(data2.remainingUndrawnCount).toBe(0);
      expect(data2.nextSlotName).toBeNull();
    });
  });
});
