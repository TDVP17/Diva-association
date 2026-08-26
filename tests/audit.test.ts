import { describe, it, expect, vi, beforeEach } from "vitest";

const create = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { auditLog: { create: (...args: unknown[]) => create(...args) } },
}));

import { logAudit } from "@/lib/audit";

describe("logAudit", () => {
  beforeEach(() => {
    create.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("writes a row with the given fields", async () => {
    create.mockResolvedValue({});
    await logAudit({
      actorId: "admin-1",
      action: "contribution_created",
      targetType: "TontineSession",
      targetId: "session-1",
      tontineSessionId: "session-1",
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        actorId: "admin-1",
        action: "contribution_created",
        targetType: "TontineSession",
        targetId: "session-1",
        tontineSessionId: "session-1",
        metadata: undefined,
      },
    });
  });

  it("defaults optional fields to null instead of leaving them undefined", async () => {
    create.mockResolvedValue({});
    await logAudit({ action: "contribution_deleted", targetType: "TontineSession", targetId: "session-2" });
    const { data } = create.mock.calls[0][0];
    expect(data.actorId).toBeNull();
    expect(data.tontineSessionId).toBeNull();
  });

  it("never throws even if the database write fails — audit logging must not break the caller", async () => {
    create.mockRejectedValue(new Error("db unavailable"));
    await expect(
      logAudit({ action: "member_approved", targetType: "Membership", targetId: "m-1" }),
    ).resolves.toBeUndefined();
  });
});
