import { describe, it, expect } from "vitest";
import { assertJoinable, sumRegisteredSlots } from "@/lib/session-joinability";

const baseSession = {
  status: "ACTIVE",
  startDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // a week out
  maxSlots: null as number | null,
  isPaused: false,
  lockedAt: null as Date | null,
};

describe("assertJoinable", () => {
  it("allows joining an open, unpaused, unlocked session with room", () => {
    expect(assertJoinable(baseSession, 0)).toEqual({ ok: true });
  });

  it("blocks joining a CLOSED session", () => {
    const result = assertJoinable({ ...baseSession, status: "CLOSED" }, 0);
    expect(result.ok).toBe(false);
  });

  it("blocks joining a paused session even if otherwise open", () => {
    const result = assertJoinable({ ...baseSession, isPaused: true }, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/paused/i);
  });

  it("blocks joining a locked session even if otherwise open", () => {
    const result = assertJoinable({ ...baseSession, lockedAt: new Date() }, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/locked/i);
  });

  it("blocks joining after the start date has passed", () => {
    const result = assertJoinable({ ...baseSession, startDate: new Date(Date.now() - 1000) }, 0);
    expect(result.ok).toBe(false);
  });

  it("blocks joining once maxSlots is reached", () => {
    const result = assertJoinable({ ...baseSession, maxSlots: 5 }, 5);
    expect(result.ok).toBe(false);
  });

  it("allows joining just under maxSlots", () => {
    const result = assertJoinable({ ...baseSession, maxSlots: 5 }, 4.5);
    expect(result.ok).toBe(true);
  });

  it("pause takes priority over an otherwise-full session — both report failure, not a crash", () => {
    const result = assertJoinable({ ...baseSession, isPaused: true, maxSlots: 1 }, 1);
    expect(result.ok).toBe(false);
  });
});

describe("sumRegisteredSlots", () => {
  it("sums only APPROVED memberships", () => {
    const total = sumRegisteredSlots([
      { status: "APPROVED", slotCount: 2 },
      { status: "PENDING", slotCount: 10 },
      { status: "APPROVED", slotCount: 1.5 },
    ]);
    expect(total).toBe(3.5);
  });

  it("treats a null slotCount as zero", () => {
    const total = sumRegisteredSlots([{ status: "APPROVED", slotCount: null }]);
    expect(total).toBe(0);
  });
});
