import { describe, it, expect, vi, beforeEach } from "vitest";

const requireAdmin = vi.fn();
vi.mock("@/lib/require-admin", () => ({ requireAdmin: (...a: unknown[]) => requireAdmin(...a) }));

const findMany = vi.fn();
const count = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    auditLog: {
      findMany: (...a: unknown[]) => findMany(...a),
      count: (...a: unknown[]) => count(...a),
    },
  },
}));

import { GET } from "@/app/api/admin/audit-logs/route";

describe("GET /api/admin/audit-logs", () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    findMany.mockReset();
    count.mockReset();
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);
  });

  it("rejects non-admins", async () => {
    requireAdmin.mockResolvedValue(null);
    const res = await GET(new Request("https://x/api/admin/audit-logs"));
    expect(res.status).toBe(403);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("builds a Prisma where clause from all active filters", async () => {
    requireAdmin.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    const url =
      "https://x/api/admin/audit-logs?startDate=2026-01-01&endDate=2026-01-31&actor=John&action=member_approved&resourceType=Membership&status=FAILED&page=2";

    await GET(new Request(url));

    const where = findMany.mock.calls[0][0].where;
    expect(where.createdAt.gte).toEqual(new Date("2026-01-01"));
    expect(where.createdAt.lte).toEqual(new Date("2026-01-31T23:59:59.999Z"));
    expect(where.actor).toEqual({ name: { contains: "John", mode: "insensitive" } });
    expect(where.action).toBe("member_approved");
    expect(where.targetType).toBe("Membership");
    expect(where.status).toBe("FAILED");
    expect(findMany.mock.calls[0][0].skip).toBe(30); // page 2, pageSize 30
  });

  it("ignores an invalid status value instead of passing it through to Prisma", async () => {
    requireAdmin.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    await GET(new Request("https://x/api/admin/audit-logs?status=NOT_A_REAL_STATUS"));

    const where = findMany.mock.calls[0][0].where;
    expect(where.status).toBeUndefined();
  });

  it("maps rows to the flattened response shape, including the joined actor name", async () => {
    requireAdmin.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    findMany.mockResolvedValue([
      {
        id: "log-1",
        createdAt: new Date("2026-01-05"),
        actorId: "admin-1",
        actor: { name: "Admin One", email: "admin@x.com" },
        actorRole: "ADMIN",
        action: "member_approved",
        targetType: "Membership",
        targetId: "m-1",
        tontineSessionId: "s-1",
        ipAddress: "1.2.3.4",
        userAgent: "Mozilla",
        status: "SUCCESS",
        failureReason: null,
        metadata: { reason: null },
        payloadBefore: { status: "PENDING" },
        payloadAfter: { status: "APPROVED" },
      },
    ]);
    count.mockResolvedValue(1);

    const res = await GET(new Request("https://x/api/admin/audit-logs"));
    const body = await res.json();

    expect(body.total).toBe(1);
    expect(body.logs[0]).toMatchObject({
      id: "log-1",
      actorName: "Admin One",
      actorEmail: "admin@x.com",
      action: "member_approved",
      payloadBefore: { status: "PENDING" },
      payloadAfter: { status: "APPROVED" },
    });
  });
});
