import { describe, it, expect, vi, beforeEach } from "vitest";

const createMany = vi.fn();
const updateMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    notification: {
      createMany: (...args: unknown[]) => createMany(...args),
      updateMany: (...args: unknown[]) => updateMany(...args),
    },
  },
}));

import { scheduleNotifications, scheduleInAppNotifications } from "@/lib/notifications/dispatch";

describe("scheduleNotifications", () => {
  beforeEach(() => {
    createMany.mockReset();
    updateMany.mockReset();
    createMany.mockResolvedValue({ count: 0 });
    updateMany.mockResolvedValue({ count: 0 });
  });

  it("does nothing and writes no rows for an empty recipient list", async () => {
    const count = await scheduleNotifications({
      channel: "EMAIL",
      type: "CONTRIBUTION_REMINDER",
      recipients: [],
    });
    expect(count).toBe(0);
    expect(createMany).not.toHaveBeenCalled();
  });

  it("stages recipients 5 minutes apart, in order", async () => {
    const before = Date.now();
    await scheduleNotifications({
      tontineSessionId: "session-1",
      channel: "WHATSAPP",
      type: "FINE_REMINDER",
      recipients: [
        { userId: "u1", message: "hello u1" },
        { userId: "u2", message: "hello u2" },
        { userId: "u3", message: "hello u3" },
      ],
    });

    expect(createMany).toHaveBeenCalledTimes(1);
    const { data } = createMany.mock.calls[0][0];
    expect(data).toHaveLength(3);

    const [row1, row2, row3] = data;
    expect(row1.userId).toBe("u1");
    expect(row2.userId).toBe("u2");
    expect(row3.userId).toBe("u3");

    const gap12 = row2.scheduledAt.getTime() - row1.scheduledAt.getTime();
    const gap23 = row3.scheduledAt.getTime() - row2.scheduledAt.getTime();
    expect(gap12).toBe(5 * 60 * 1000);
    expect(gap23).toBe(5 * 60 * 1000);
    expect(row1.scheduledAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(row1.status).toBe("SCHEDULED");
  });

  it("carries the tontineSessionId, channel, and type onto every row", async () => {
    await scheduleNotifications({
      tontineSessionId: "session-42",
      channel: "EMAIL",
      type: "ADMIN_BROADCAST",
      recipients: [{ userId: "u1", message: "hi" }],
    });
    const { data } = createMany.mock.calls[0][0];
    expect(data[0]).toMatchObject({
      tontineSessionId: "session-42",
      channel: "EMAIL",
      type: "ADMIN_BROADCAST",
      message: "hi",
    });
  });

  it("carries actionUrl onto a row when provided, and leaves it undefined when omitted", async () => {
    await scheduleNotifications({
      channel: "IN_APP",
      type: "SWAP_REQUEST_CREATED",
      recipients: [
        { userId: "u1", message: "hi", actionUrl: "/chat" },
        { userId: "u2", message: "hi" },
      ],
    });
    const { data } = createMany.mock.calls[0][0];
    expect(data[0].actionUrl).toBe("/chat");
    expect(data[1].actionUrl).toBeUndefined();
  });
});

describe("scheduleInAppNotifications", () => {
  beforeEach(() => {
    createMany.mockReset();
    updateMany.mockReset();
    createMany.mockResolvedValue({ count: 0 });
    updateMany.mockResolvedValue({ count: 0 });
  });

  it("creates both an IN_APP row (immediately flipped to SENT) and a companion PUSH row (left SCHEDULED)", async () => {
    await scheduleInAppNotifications({
      tontineSessionId: "session-1",
      type: "PAYOUT_TURN",
      recipients: [{ userId: "u1", message: "it's your turn" }],
    });

    expect(createMany).toHaveBeenCalledTimes(2);
    expect(createMany.mock.calls[0][0].data[0].channel).toBe("IN_APP");
    expect(createMany.mock.calls[1][0].data[0].channel).toBe("PUSH");
  });

  it("the SENT flip is scoped to channel: IN_APP — it must never also catch the companion PUSH row", async () => {
    await scheduleInAppNotifications({
      tontineSessionId: "session-1",
      type: "PAYOUT_TURN",
      recipients: [{ userId: "u1", message: "it's your turn" }],
    });

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0][0]).toMatchObject({
      where: expect.objectContaining({ channel: "IN_APP", status: "SCHEDULED" }),
      data: { status: "SENT", sentAt: expect.any(Date) },
    });
  });

  it("does nothing at all for an empty recipient list — no IN_APP row, no PUSH row, no update", async () => {
    const count = await scheduleInAppNotifications({ type: "DRAW_LAUNCHED", recipients: [] });
    expect(count).toBe(0);
    expect(createMany).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });
});
