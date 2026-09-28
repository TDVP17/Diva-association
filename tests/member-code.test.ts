import { describe, it, expect, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
const findMany = vi.fn();
const update = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      findMany: (...args: unknown[]) => findMany(...args),
      update: (...args: unknown[]) => update(...args),
    },
  },
}));

import { generateUniqueMemberCode, ensureMemberCode } from "@/lib/member-code";

describe("generateUniqueMemberCode", () => {
  beforeEach(() => {
    findUnique.mockReset();
    findMany.mockReset();
    findMany.mockResolvedValue([]);
    findUnique.mockResolvedValue(null);
  });

  it("returns DIVA0001 when no members exist yet", async () => {
    const code = await generateUniqueMemberCode();
    expect(code).toBe("DIVA0001");
  });

  it("increments sequentially based on highest existing code (DIVA0020 -> DIVA0021)", async () => {
    findMany.mockResolvedValueOnce([
      { memberCode: "DIVA0001" },
      { memberCode: "DIVA0019" },
      { memberCode: "DIVA0020" },
    ]);
    const code = await generateUniqueMemberCode();
    expect(code).toBe("DIVA0021");
  });

  it("always produces exactly 8 characters", async () => {
    findMany.mockResolvedValueOnce([{ memberCode: "DIVA0005" }]);
    const code = await generateUniqueMemberCode();
    expect(code.length).toBe(8);
    expect(code).toMatch(/^DIVA\d{4}$/);
  });
});

describe("ensureMemberCode", () => {
  beforeEach(() => {
    findUnique.mockReset();
    findMany.mockReset();
    update.mockReset();
    findMany.mockResolvedValue([]);
  });

  it("is idempotent — returns the existing valid DIVA0001 code without generating a new one", async () => {
    findUnique.mockResolvedValueOnce({ memberCode: "DIVA0005" });
    const code = await ensureMemberCode("user-1");
    expect(code).toBe("DIVA0005");
    expect(update).not.toHaveBeenCalled();
  });

  it("generates and persists a new code when the user has none yet", async () => {
    findUnique.mockResolvedValueOnce({ memberCode: null });
    findUnique.mockResolvedValueOnce(null);
    update.mockResolvedValueOnce({ memberCode: "DIVA0001" });
    const code = await ensureMemberCode("user-2");
    expect(update).toHaveBeenCalledWith({ where: { id: "user-2" }, data: { memberCode: "DIVA0001" } });
    expect(code).toBe("DIVA0001");
  });
});
