import { describe, it, expect, vi, beforeEach } from "vitest";

const auth = vi.fn();
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => auth(...a) }));

const upsert = vi.fn();
const deleteMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    pushSubscription: {
      upsert: (...a: unknown[]) => upsert(...a),
      deleteMany: (...a: unknown[]) => deleteMany(...a),
    },
  },
}));

import { POST as subscribe } from "@/app/api/push/subscribe/route";
import { POST as unsubscribe } from "@/app/api/push/unsubscribe/route";

function fakeRequest(body: unknown, headers: Record<string, string> = {}) {
  return {
    json: async () => body,
    headers: { get: (key: string) => headers[key.toLowerCase()] ?? null },
  } as unknown as Request;
}

describe("POST /api/push/subscribe", () => {
  beforeEach(() => {
    auth.mockReset();
    upsert.mockReset();
  });

  it("401s when unauthenticated", async () => {
    auth.mockResolvedValue(null);
    const res = await subscribe(fakeRequest({}));
    expect(res.status).toBe(401);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("400s on a malformed body", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    const res = await subscribe(fakeRequest({ endpoint: "https://push.example/1" }));
    expect(res.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("upserts by endpoint, scoped to the authenticated user", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    upsert.mockResolvedValue({});
    const res = await subscribe(
      fakeRequest(
        { endpoint: "https://push.example/1", keys: { p256dh: "a", auth: "b" } },
        { "user-agent": "TestAgent/1.0" },
      ),
    );
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { endpoint: "https://push.example/1" },
        create: expect.objectContaining({ userId: "user-1", p256dh: "a", auth: "b", userAgent: "TestAgent/1.0" }),
        update: expect.objectContaining({ userId: "user-1", p256dh: "a", auth: "b" }),
      }),
    );
  });
});

describe("POST /api/push/unsubscribe", () => {
  beforeEach(() => {
    auth.mockReset();
    deleteMany.mockReset();
  });

  it("401s when unauthenticated", async () => {
    auth.mockResolvedValue(null);
    const res = await unsubscribe(fakeRequest({ endpoint: "https://push.example/1" }));
    expect(res.status).toBe(401);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("scopes the delete to both the endpoint AND the caller's own userId", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    deleteMany.mockResolvedValue({ count: 1 });
    const res = await unsubscribe(fakeRequest({ endpoint: "https://push.example/1" }));
    expect(res.status).toBe(200);
    expect(deleteMany).toHaveBeenCalledWith({
      where: { endpoint: "https://push.example/1", userId: "user-1" },
    });
  });
});
