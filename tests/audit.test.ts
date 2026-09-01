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
        actorRole: null,
        action: "contribution_created",
        targetType: "TontineSession",
        targetId: "session-1",
        tontineSessionId: "session-1",
        metadata: undefined,
        payloadBefore: undefined,
        payloadAfter: undefined,
        ipAddress: null,
        userAgent: null,
        status: "SUCCESS",
        failureReason: null,
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

  it("extracts ipAddress/userAgent from a passed Request", async () => {
    create.mockResolvedValue({});
    const request = new Request("https://example.com", {
      headers: { "x-forwarded-for": "197.234.221.45, 10.0.0.1", "user-agent": "Mozilla/5.0" },
    });
    await logAudit({ action: "2fa_verified", targetType: "SecuritySettings", request });
    const { data } = create.mock.calls[0][0];
    expect(data.ipAddress).toBe("197.234.221.45");
    expect(data.userAgent).toBe("Mozilla/5.0");
  });

  it("never throws even if the database write fails — audit logging must not break the caller", async () => {
    create.mockRejectedValue(new Error("db unavailable"));
    await expect(
      logAudit({ action: "member_approved", targetType: "Membership", targetId: "m-1" }),
    ).resolves.toBeUndefined();
  });
});
