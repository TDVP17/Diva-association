import { describe, it, expect, vi, beforeEach } from "vitest";

const auth = vi.fn();
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => auth(...a) }));

import { requireAdmin } from "@/lib/require-admin";

describe("requireAdmin", () => {
  beforeEach(() => {
    auth.mockReset();
  });

  it("returns null for an unauthenticated request", async () => {
    auth.mockResolvedValue(null);
    expect(await requireAdmin()).toBeNull();
  });

  it("returns null for an authenticated MEMBER — the ordinary-user-can't-reach-admin-routes guarantee", async () => {
    auth.mockResolvedValue({ user: { id: "u1", role: "MEMBER" } });
    expect(await requireAdmin()).toBeNull();
  });

  it("returns the session for an authenticated ADMIN", async () => {
    const session = { user: { id: "u2", role: "ADMIN" } };
    auth.mockResolvedValue(session);
    expect(await requireAdmin()).toBe(session);
  });
});
