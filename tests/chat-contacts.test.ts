import { describe, it, expect, vi, beforeEach } from "vitest";

const auth = vi.fn();
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => auth(...a) }));

const chatMessageFindMany = vi.fn();
const chatMessageGroupBy = vi.fn();
const userFindMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    chatMessage: {
      findMany: (...a: unknown[]) => chatMessageFindMany(...a),
      groupBy: (...a: unknown[]) => chatMessageGroupBy(...a),
    },
    user: {
      findMany: (...a: unknown[]) => userFindMany(...a),
    },
  },
}));

vi.mock("@/lib/chat/support-admin", () => ({ getSupportAdmin: vi.fn() }));

import { GET } from "@/app/api/chat/contacts/route";

describe("GET /api/chat/contacts — admin conversation list", () => {
  beforeEach(() => {
    auth.mockReset();
    chatMessageFindMany.mockReset();
    chatMessageGroupBy.mockReset();
    userFindMany.mockReset();
    chatMessageGroupBy.mockResolvedValue([]);
  });

  it("scopes the admin's contact list to users with real message history — not every registered member", async () => {
    auth.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    chatMessageFindMany.mockResolvedValue([
      { id: "m1", senderId: "member-1", receiverId: "admin-1", content: "hi", createdAt: new Date("2026-01-01") },
      { id: "m2", senderId: "admin-1", receiverId: "member-2", content: "hey", createdAt: new Date("2026-01-02") },
    ]);
    userFindMany.mockResolvedValue([
      { id: "member-1", name: "Member One", avatar: null, image: null },
      { id: "member-2", name: "Member Two", avatar: null, image: null },
    ]);

    await GET();

    // The admin branch must never fall back to "every registered member".
    const badCall = userFindMany.mock.calls.find(
      (call) => JSON.stringify(call[0]?.where) === JSON.stringify({ role: "MEMBER" }),
    );
    expect(badCall).toBeUndefined();

    // It must instead be scoped to the actual conversation partners derived
    // from ChatMessage rows involving this admin.
    const scopedCall = userFindMany.mock.calls.find((call) => call[0]?.where?.id?.in);
    expect(scopedCall).toBeDefined();
    expect(scopedCall![0].where.id.in.sort()).toEqual(["member-1", "member-2"]);
  });

  it("returns an empty member list for an admin with no message history at all", async () => {
    auth.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    chatMessageFindMany.mockResolvedValue([]);

    const res = await GET();
    const body = await res.json();

    expect(body.members).toEqual([]);
    expect(userFindMany).not.toHaveBeenCalled();
  });
});
