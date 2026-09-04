import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const findManySession = vi.fn();
const findUniqueMembership = vi.fn();
const findManyMembership = vi.fn();
const createTurnReminderLog = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    tontineSession: { findMany: (...a: unknown[]) => findManySession(...a) },
    membership: {
      findUnique: (...a: unknown[]) => findUniqueMembership(...a),
      findMany: (...a: unknown[]) => findManyMembership(...a),
    },
    turnReminderLog: { create: (...a: unknown[]) => createTurnReminderLog(...a) },
  },
}));

const getDesignatedSlot = vi.fn();
vi.mock("@/lib/round-robin-lock", () => ({
  getDesignatedSlot: (...a: unknown[]) => getDesignatedSlot(...a),
}));

const scheduleNotifications = vi.fn().mockResolvedValue(1);
const scheduleInAppNotifications = vi.fn().mockResolvedValue(1);
vi.mock("@/lib/notifications/dispatch", () => ({
  scheduleNotifications: (...a: unknown[]) => scheduleNotifications(...a),
  scheduleInAppNotifications: (...a: unknown[]) => scheduleInAppNotifications(...a),
}));

import { GET } from "@/app/api/crons/turn-reminder/route";

function fakeCronRequest(): Request {
  return { headers: { get: () => `Bearer ${process.env.CRON_SECRET}` } } as unknown as Request;
}

// Fixed "now" (mid-day UTC, well clear of any Cameroon-local date boundary)
// so "tomorrow" is deterministic regardless of which real-world day the
// suite runs on. MONTHLY_1 (due on the 1st of the month) + a startDate of
// the 15th makes getCycleDateForRound's round-1 date land on exactly
// Feb 1 2026 — the same calendar day as "tomorrow" below.
const NOW = new Date("2026-01-31T10:00:00Z");
const TOMORROW_KEY = new Date(Date.UTC(2026, 1, 1)); // Feb 1 2026, UTC midnight
const SESSION_START_DATE = new Date("2026-01-15T10:00:00Z");

const activeSession = {
  id: "session-1",
  type: "MONTHLY_1" as const,
  status: "ACTIVE" as const,
  startDate: SESSION_START_DATE,
  amount: 2500,
  fee: 100,
  title: "Monthly Group",
};

describe("GET /api/crons/turn-reminder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    findManySession.mockReset();
    findUniqueMembership.mockReset();
    findManyMembership.mockReset();
    createTurnReminderLog.mockReset();
    getDesignatedSlot.mockReset();
    scheduleNotifications.mockClear();
    scheduleInAppNotifications.mockClear();
    process.env.CRON_SECRET = "test-secret";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("401s without the correct bearer token", async () => {
    const res = await GET({ headers: { get: () => "Bearer wrong" } } as unknown as Request);
    expect(res.status).toBe(401);
    expect(findManySession).not.toHaveBeenCalled();
  });

  it("only ever queries ACTIVE sessions — a DRAFT/DRAWING session can never produce a reminder", async () => {
    findManySession.mockResolvedValue([]);
    await GET(fakeCronRequest());
    expect(findManySession).toHaveBeenCalledWith({ where: { status: "ACTIVE" } });
  });

  it("skips a session with no published ranking (no designated slot)", async () => {
    findManySession.mockResolvedValue([activeSession]);
    getDesignatedSlot.mockResolvedValue(null);

    const res = await GET(fakeCronRequest());
    const body = await res.json();

    expect(body.notified).toBe(0);
    expect(createTurnReminderLog).not.toHaveBeenCalled();
  });

  it("does nothing when the designated slot's estimated date is not tomorrow", async () => {
    findManySession.mockResolvedValue([activeSession]);
    // Position 2 lands a full month later than tomorrow, not on it.
    getDesignatedSlot.mockResolvedValue({ id: "slot-1", membershipId: "membership-1", officialPosition: 2 });

    const res = await GET(fakeCronRequest());
    const body = await res.json();

    expect(body.notified).toBe(0);
    expect(createTurnReminderLog).not.toHaveBeenCalled();
  });

  it("sends Email + WhatsApp + In-App/Push and logs idempotently when the estimated date is tomorrow", async () => {
    findManySession.mockResolvedValue([activeSession]);
    getDesignatedSlot.mockResolvedValue({ id: "slot-1", membershipId: "membership-1", officialPosition: 1 });
    createTurnReminderLog.mockResolvedValue({ id: "log-1" });
    findUniqueMembership.mockResolvedValue({
      userId: "user-1",
      user: { id: "user-1", name: "Marie Fotso", phone: "677123456", preferredLang: "fr" },
    });
    findManyMembership.mockResolvedValue([{ slotCount: 2 }, { slotCount: 1 }]);

    const res = await GET(fakeCronRequest());
    const body = await res.json();

    expect(body.notified).toBe(1);
    expect(createTurnReminderLog).toHaveBeenCalledWith({
      data: { membershipSlotId: "slot-1", estimatedDate: TOMORROW_KEY },
    });

    expect(scheduleNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "EMAIL", type: "TURN_REMINDER_TOMORROW" }),
    );
    expect(scheduleNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "WHATSAPP", type: "TURN_REMINDER_TOMORROW" }),
    );
    expect(scheduleInAppNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ type: "TURN_REMINDER_TOMORROW" }),
    );
  });

  it("skips the WhatsApp channel (but still sends Email/In-App/Push) when the member has no phone on file", async () => {
    findManySession.mockResolvedValue([activeSession]);
    getDesignatedSlot.mockResolvedValue({ id: "slot-1", membershipId: "membership-1", officialPosition: 1 });
    createTurnReminderLog.mockResolvedValue({ id: "log-1" });
    findUniqueMembership.mockResolvedValue({
      userId: "user-1",
      user: { id: "user-1", name: "Marie Fotso", phone: null, preferredLang: "fr" },
    });
    findManyMembership.mockResolvedValue([{ slotCount: 1 }]);

    await GET(fakeCronRequest());

    const whatsappCalls = scheduleNotifications.mock.calls.filter((c) => c[0].channel === "WHATSAPP");
    expect(whatsappCalls).toHaveLength(0);
    const emailCalls = scheduleNotifications.mock.calls.filter((c) => c[0].channel === "EMAIL");
    expect(emailCalls).toHaveLength(1);
  });

  it("does not re-notify the same slot for the same estimated date (idempotency)", async () => {
    findManySession.mockResolvedValue([activeSession]);
    getDesignatedSlot.mockResolvedValue({ id: "slot-1", membershipId: "membership-1", officialPosition: 1 });
    createTurnReminderLog.mockResolvedValue(null); // unique-constraint collision — already sent

    const res = await GET(fakeCronRequest());
    const body = await res.json();

    expect(body.notified).toBe(0);
    expect(findUniqueMembership).not.toHaveBeenCalled();
    expect(scheduleNotifications).not.toHaveBeenCalled();
  });
});
