import { describe, it, expect, vi, beforeEach } from "vitest";

const auth = vi.fn();
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => auth(...a) }));

const userFindUnique = vi.fn();
const userUpdate = vi.fn();
const chatMessageCreate = vi.fn();
const transaction = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: (...a: unknown[]) => userFindUnique(...a),
      update: (...a: unknown[]) => userUpdate(...a),
    },
    chatMessage: { create: (...a: unknown[]) => chatMessageCreate(...a) },
    $transaction: (...a: unknown[]) => transaction(...a),
  },
}));

import { POST } from "@/app/api/chat/messages/route";

function fakeRequest(body: unknown) {
  return { json: async () => body } as unknown as Request;
}

describe("POST /api/chat/messages — auto-reply side effect is best-effort", () => {
  beforeEach(() => {
    auth.mockReset();
    userFindUnique.mockReset();
    userUpdate.mockReset();
    chatMessageCreate.mockReset();
    transaction.mockReset();
  });

  it("still returns the sent message even when the admin auto-reply transaction throws", async () => {
    auth.mockResolvedValue({ user: { id: "member-1", role: "MEMBER" } });
    // First findUnique: the receiver lookup. Second: the sender lookup for the auto-reply check.
    userFindUnique
      .mockResolvedValueOnce({ id: "admin-1", role: "ADMIN" })
      .mockResolvedValueOnce({ name: "Member One", preferredLang: "en", lastAdminAutoReplyAt: null });
    // Called once for the primary message, once more while building the
    // auto-reply transaction's argument array — both are real invocations.
    chatMessageCreate.mockResolvedValue({
      id: "msg-1",
      senderId: "member-1",
      content: "hello",
      createdAt: new Date("2026-01-01T10:00:00Z"),
    });
    userUpdate.mockResolvedValue({});
    transaction.mockRejectedValue(new Error("serialization conflict"));

    const res = await POST(fakeRequest({ receiverId: "admin-1", content: "hello" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe("msg-1");
    expect(body.content).toBe("hello");
    // The primary message create (first call) must have used the sender's
    // own id/content, regardless of the auto-reply transaction failing.
    expect(chatMessageCreate.mock.calls[0][0]).toMatchObject({
      data: { senderId: "member-1", receiverId: "admin-1", content: "hello" },
    });
  });

  it("rejects an unauthenticated request before touching the database", async () => {
    auth.mockResolvedValue(null);
    const res = await POST(fakeRequest({ receiverId: "admin-1", content: "hello" }));
    expect(res.status).toBe(401);
    expect(chatMessageCreate).not.toHaveBeenCalled();
  });

  it("404s when the recipient doesn't exist", async () => {
    auth.mockResolvedValue({ user: { id: "member-1", role: "MEMBER" } });
    userFindUnique.mockResolvedValueOnce(null);
    const res = await POST(fakeRequest({ receiverId: "ghost", content: "hello" }));
    expect(res.status).toBe(404);
    expect(chatMessageCreate).not.toHaveBeenCalled();
  });

  it("403s a member trying to message another member — messaging is admin-only", async () => {
    auth.mockResolvedValue({ user: { id: "member-1", role: "MEMBER" } });
    userFindUnique.mockResolvedValueOnce({ id: "member-2", role: "MEMBER" });
    const res = await POST(fakeRequest({ receiverId: "member-2", content: "hey, want to swap?" }));
    expect(res.status).toBe(403);
    expect(chatMessageCreate).not.toHaveBeenCalled();
  });

  it("allows a member to message an admin", async () => {
    auth.mockResolvedValue({ user: { id: "member-1", role: "MEMBER" } });
    userFindUnique
      .mockResolvedValueOnce({ id: "admin-1", role: "ADMIN" })
      .mockResolvedValueOnce({ name: "Member One", preferredLang: "en", lastAdminAutoReplyAt: new Date() });
    chatMessageCreate.mockResolvedValue({
      id: "msg-2",
      senderId: "member-1",
      content: "hello admin",
      createdAt: new Date("2026-01-01T10:00:00Z"),
    });
    const res = await POST(fakeRequest({ receiverId: "admin-1", content: "hello admin" }));
    expect(res.status).toBe(200);
    expect(chatMessageCreate).toHaveBeenCalledTimes(1);
  });

  it("allows an admin to message a member", async () => {
    auth.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    userFindUnique.mockResolvedValueOnce({ id: "member-1", role: "MEMBER" });
    chatMessageCreate.mockResolvedValue({
      id: "msg-3",
      senderId: "admin-1",
      content: "how can we help?",
      createdAt: new Date("2026-01-01T10:00:00Z"),
    });
    const res = await POST(fakeRequest({ receiverId: "member-1", content: "how can we help?" }));
    expect(res.status).toBe(200);
    expect(chatMessageCreate).toHaveBeenCalledTimes(1);
  });
});
