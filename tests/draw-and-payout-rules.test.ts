import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({
  auth: () => mockAuth(),
}));

const mockFindUniqueMembershipSlot = vi.fn();
const mockFindManyMembership = vi.fn();
const mockFindFirstMembership = vi.fn();
const mockCountContribution = vi.fn();
const mockCreatePayout = vi.fn();
const mockFindUniqueSession = vi.fn();
const mockFindManyMembershipSlot = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    membershipSlot: {
      findUnique: (...a: unknown[]) => mockFindUniqueMembershipSlot(...a),
      findMany: (...a: unknown[]) => mockFindManyMembershipSlot(...a),
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
  },
}));

const mockGetDesignatedSlot = vi.fn();
vi.mock("@/lib/round-robin-lock", () => ({
  getDesignatedSlot: (...a: unknown[]) => mockGetDesignatedSlot(...a),
}));

import { POST as postPayoutClaim } from "@/app/api/payments/payout-claims/route";
import { GET as getPayoutOrder } from "@/app/api/sessions/[id]/payout-order/route";

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
});
