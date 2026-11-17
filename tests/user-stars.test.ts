import { describe, it, expect, vi, beforeEach } from "vitest";

const requireAdmin = vi.fn();
vi.mock("@/lib/require-admin", () => ({ requireAdmin: (...a: unknown[]) => requireAdmin(...a) }));

const logAudit = vi.fn();
vi.mock("@/lib/audit", () => ({ logAudit: (...a: unknown[]) => logAudit(...a) }));

const userFindUnique = vi.fn();
const userUpdate = vi.fn();
const tontineSessionFindUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: (...a: unknown[]) => userFindUnique(...a),
      update: (...a: unknown[]) => userUpdate(...a),
    },
    tontineSession: {
      findUnique: (...a: unknown[]) => tontineSessionFindUnique(...a),
    },
  },
}));

import { PATCH } from "@/app/api/admin/users/[id]/stars/route";
import { awardStarsForCompletedSession } from "@/lib/stars";

describe("User Stars Feature", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("PATCH /api/admin/users/[id]/stars", () => {
    it("rejects non-admins", async () => {
      requireAdmin.mockResolvedValue(null);
      const req = new Request("https://x/api/admin/users/u1/stars", {
        method: "PATCH",
        body: JSON.stringify({ stars: 3 }),
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: "u1" }) });
      expect(res.status).toBe(403);
    });

    it("rejects stars out of range (e.g. 6 or -1)", async () => {
      requireAdmin.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
      const req = new Request("https://x/api/admin/users/u1/stars", {
        method: "PATCH",
        body: JSON.stringify({ stars: 6 }),
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: "u1" }) });
      expect(res.status).toBe(400);
    });

    it("updates stars successfully and logs audit", async () => {
      requireAdmin.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
      userFindUnique.mockResolvedValue({ id: "u1", name: "Alice", email: "alice@test.com", stars: 0 });
      userUpdate.mockResolvedValue({ id: "u1", name: "Alice", stars: 4 });

      const req = new Request("https://x/api/admin/users/u1/stars", {
        method: "PATCH",
        body: JSON.stringify({ stars: 4 }),
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: "u1" }) });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(userUpdate).toHaveBeenCalledWith({
        where: { id: "u1" },
        data: { stars: 4 },
        select: { id: true, name: true, stars: true },
      });
      expect(logAudit).toHaveBeenCalled();
    });
  });

  describe("awardStarsForCompletedSession", () => {
    it("awards +1 star to members with zero fines upon session completion", async () => {
      tontineSessionFindUnique.mockResolvedValue({
        id: "s1",
        title: "Tontine Hebdo",
        memberships: [
          {
            id: "m1",
            status: "APPROVED",
            user: { id: "u1", name: "Alice", stars: 0 },
            slots: [
              { id: "sl1", fines: [] }, // 0 fines
            ],
          },
          {
            id: "m2",
            status: "APPROVED",
            user: { id: "u2", name: "Bob", stars: 2 },
            slots: [
              { id: "sl2", fines: [{ id: "f1" }] }, // had 1 fine
            ],
          },
        ],
      });

      const result = await awardStarsForCompletedSession("s1", { id: "admin-1", role: "ADMIN" as any });

      expect(result.updatedCount).toBe(1);
      expect(result.rewardedUsers[0]).toEqual({
        id: "u1",
        name: "Alice",
        oldStars: 0,
        newStars: 1,
      });

      expect(userUpdate).toHaveBeenCalledTimes(1);
      expect(userUpdate).toHaveBeenCalledWith({
        where: { id: "u1" },
        data: { stars: 1 },
      });
    });

    it("caps stars at 5", async () => {
      tontineSessionFindUnique.mockResolvedValue({
        id: "s1",
        title: "Tontine Hebdo",
        memberships: [
          {
            id: "m1",
            status: "APPROVED",
            user: { id: "u1", name: "Alice", stars: 5 },
            slots: [{ id: "sl1", fines: [] }],
          },
        ],
      });

      const result = await awardStarsForCompletedSession("s1", { id: "admin-1", role: "ADMIN" as any });
      expect(result.updatedCount).toBe(0);
      expect(userUpdate).not.toHaveBeenCalled();
    });
  });
});
