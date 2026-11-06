import { describe, it, expect, vi, beforeEach } from "vitest";

const sessionFindUnique = vi.fn();
const sessionUpdate = vi.fn();
const notificationFindFirst = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tontineSession: {
      findUnique: (...a: unknown[]) => sessionFindUnique(...a),
      update: (...a: unknown[]) => sessionUpdate(...a),
    },
    notification: {
      findFirst: (...a: unknown[]) => notificationFindFirst(...a),
    },
  },
}));

const scheduleInAppNotifications = vi.fn();
vi.mock("@/lib/notifications/dispatch", () => ({
  scheduleInAppNotifications: (...a: unknown[]) => scheduleInAppNotifications(...a),
}));

import { notifyDrawCompletedIfAllDrawn } from "@/lib/notifications/draw-complete";

describe("notifyDrawCompletedIfAllDrawn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false if session is not found", async () => {
    sessionFindUnique.mockResolvedValue(null);
    const result = await notifyDrawCompletedIfAllDrawn("sess-1");
    expect(result).toBe(false);
    expect(scheduleInAppNotifications).not.toHaveBeenCalled();
  });

  it("returns false if not all slots have drawn balls", async () => {
    sessionFindUnique.mockResolvedValue({
      id: "sess-1",
      title: "Tontine Diamant",
      status: "DRAWING",
      memberships: [
        {
          userId: "user-1",
          status: "APPROVED",
          slots: [
            { id: "slot-1", ballDrawn: 1, officialPosition: 1, beneficiaryName: "Alice" },
            { id: "slot-2", ballDrawn: null, officialPosition: 2, beneficiaryName: "Alice 2" },
          ],
        },
      ],
    });

    const result = await notifyDrawCompletedIfAllDrawn("sess-1");
    expect(result).toBe(false);
    expect(scheduleInAppNotifications).not.toHaveBeenCalled();
  });

  it("returns false if notification was already sent (idempotency)", async () => {
    sessionFindUnique.mockResolvedValue({
      id: "sess-1",
      title: "Tontine Diamant",
      status: "DRAWING",
      memberships: [
        {
          userId: "user-1",
          status: "APPROVED",
          slots: [
            { id: "slot-1", ballDrawn: 1, officialPosition: 1, beneficiaryName: "Alice" },
          ],
        },
      ],
    });
    notificationFindFirst.mockResolvedValue({ id: "notif-existing" });

    const result = await notifyDrawCompletedIfAllDrawn("sess-1");
    expect(result).toBe(false);
    expect(scheduleInAppNotifications).not.toHaveBeenCalled();
  });

  it("notifies members when all slots have drawn their balls and positions are assigned", async () => {
    sessionFindUnique.mockResolvedValue({
      id: "sess-1",
      title: "Tontine Diamant",
      status: "DRAWING",
      memberships: [
        {
          userId: "user-1",
          status: "APPROVED",
          slots: [
            { id: "slot-1", ballDrawn: 1, officialPosition: 1, beneficiaryName: "Alice" },
          ],
        },
        {
          userId: "user-2",
          status: "APPROVED",
          slots: [
            { id: "slot-2", ballDrawn: 2, officialPosition: 2, beneficiaryName: "Bob" },
          ],
        },
      ],
    });
    notificationFindFirst.mockResolvedValue(null);
    sessionUpdate.mockResolvedValue({ id: "sess-1", status: "ACTIVE" });
    scheduleInAppNotifications.mockResolvedValue(2);

    const result = await notifyDrawCompletedIfAllDrawn("sess-1");
    expect(result).toBe(true);

    expect(sessionUpdate).toHaveBeenCalledWith({
      where: { id: "sess-1" },
      data: { status: "ACTIVE" },
    });

    expect(scheduleInAppNotifications).toHaveBeenCalledWith({
      tontineSessionId: "sess-1",
      type: "CONTRIBUTION_REMINDER",
      recipients: expect.arrayContaining([
        expect.objectContaining({
          userId: "user-1",
          messageKey: "drawCompletedReadyToContribute",
        }),
        expect.objectContaining({
          userId: "user-2",
          messageKey: "drawCompletedReadyToContribute",
        }),
      ]),
    });
  });
});

