import { describe, it, expect, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
const update = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      update: (...args: unknown[]) => update(...args),
    },
  },
}));

import { generateUniqueMemberCode, ensureMemberCode } from "@/lib/member-code";

describe("generateUniqueMemberCode", () => {
  beforeEach(() => {
    findUnique.mockReset();
  });

  it("returns a code matching the DIVA-XXXX-XXXX shape", async () => {
    findUnique.mockResolvedValue(null); // never collides
    const code = await generateUniqueMemberCode();
    expect(code).toMatch(/^DIVA-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
  });

  it("excludes visually ambiguous characters (0, O, 1, I, L) from the random segments", async () => {
    findUnique.mockResolvedValue(null);
    for (let i = 0; i < 20; i++) {
      const code = await generateUniqueMemberCode();
      const randomSegments = code.replace(/^DIVA-/, "");
      expect(randomSegments).not.toMatch(/[01OIL]/);
    }
  });

  it("retries on collision until it finds a free code", async () => {
    findUnique
      .mockResolvedValueOnce({ id: "taken-1" })
      .mockResolvedValueOnce({ id: "taken-2" })
      .mockResolvedValueOnce(null);
    const code = await generateUniqueMemberCode();
    expect(findUnique).toHaveBeenCalledTimes(3);
    expect(code).toMatch(/^DIVA-/);
  });

  it("gives up after 10 attempts rather than looping forever", async () => {
    findUnique.mockResolvedValue({ id: "always-taken" });
    await expect(generateUniqueMemberCode()).rejects.toThrow();
    expect(findUnique).toHaveBeenCalledTimes(10);
  });
});

describe("ensureMemberCode", () => {
  beforeEach(() => {
    findUnique.mockReset();
    update.mockReset();
  });

  it("is idempotent — returns the existing code without generating a new one", async () => {
    findUnique.mockResolvedValueOnce({ memberCode: "DIVA-EXST-CODE" });
    const code = await ensureMemberCode("user-1");
    expect(code).toBe("DIVA-EXST-CODE");
    expect(update).not.toHaveBeenCalled();
  });

  it("generates and persists a new code when the user has none yet", async () => {
    findUnique.mockResolvedValueOnce({ memberCode: null }); // ensureMemberCode's own lookup
    findUnique.mockResolvedValue(null); // generateUniqueMemberCode's collision check
    update.mockResolvedValueOnce({ memberCode: "DIVA-NEWX-CODE" });
    const code = await ensureMemberCode("user-2");
    expect(update).toHaveBeenCalledWith({ where: { id: "user-2" }, data: { memberCode: expect.any(String) } });
    expect(code).toBe("DIVA-NEWX-CODE");
  });
});
