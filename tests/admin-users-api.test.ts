import { describe, it, expect, vi, beforeEach } from "vitest";

const requireAdmin = vi.fn();
vi.mock("@/lib/require-admin", () => ({ requireAdmin: (...a: unknown[]) => requireAdmin(...a) }));

const findMany = vi.fn();
const count = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findMany: (...a: unknown[]) => findMany(...a),
      count: (...a: unknown[]) => count(...a),
    },
  },
}));

import { GET } from "@/app/api/admin/users/route";

describe("GET /api/admin/users", () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    findMany.mockReset();
    count.mockReset();
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);
  });

  it("rejects non-admins", async () => {
    requireAdmin.mockResolvedValue(null);
    const res = await GET(new Request("https://x/api/admin/users"));
    expect(res.status).toBe(403);
    expect(count).not.toHaveBeenCalled();
  });

  it("returns the true platform-wide total, independent of the take:200 cap on the returned rows", async () => {
    requireAdmin.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    findMany.mockResolvedValue(Array.from({ length: 200 }, (_, i) => ({
      id: `u${i}`,
      name: `User ${i}`,
      email: `u${i}@x.com`,
      phone: null,
      avatar: null,
      image: null,
      role: "MEMBER",
      memberCode: null,
      city: null,
      neighborhood: null,
      createdAt: new Date(),
      _count: { memberships: 0 },
    })));
    count.mockResolvedValue(347);

    const res = await GET(new Request("https://x/api/admin/users"));
    const body = await res.json();

    expect(body.total).toBe(347);
    expect(body.users).toHaveLength(200);
    // The unfiltered count call (no search query) must use an undefined where clause.
    expect(count.mock.calls[0][0]).toEqual({ where: undefined });
  });

  it("counts only the matching rows when a search query is given", async () => {
    requireAdmin.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    count.mockResolvedValue(3);

    const res = await GET(new Request("https://x/api/admin/users?q=jean"));
    const body = await res.json();

    expect(body.total).toBe(3);
    expect(count.mock.calls[0][0].where.OR).toBeDefined();
  });
});
