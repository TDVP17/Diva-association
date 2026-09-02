import { describe, it, expect, vi, beforeEach } from "vitest";

const findManyNotification = vi.fn();
const updateNotification = vi.fn();
const notificationCount = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    notification: {
      findMany: (...a: unknown[]) => findManyNotification(...a),
      update: (...a: unknown[]) => updateNotification(...a),
      count: (...a: unknown[]) => notificationCount(...a),
    },
  },
}));

const sendEmail = vi.fn();
vi.mock("@/lib/email/resend", () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));

const sendWhatsAppMessage = vi.fn();
vi.mock("@/lib/whatsapp/evolution", () => ({ sendWhatsAppMessage: (...a: unknown[]) => sendWhatsAppMessage(...a) }));

const sendPushToUser = vi.fn();
vi.mock("@/lib/push/send", () => ({ sendPushToUser: (...a: unknown[]) => sendPushToUser(...a) }));

import { GET } from "@/app/api/crons/process-notifications/route";

function fakeCronRequest(): Request {
  return { headers: { get: () => `Bearer ${process.env.CRON_SECRET}` } } as unknown as Request;
}

describe("GET /api/crons/process-notifications — PUSH channel", () => {
  beforeEach(() => {
    findManyNotification.mockReset();
    updateNotification.mockReset();
    notificationCount.mockReset();
    sendEmail.mockReset();
    sendWhatsAppMessage.mockReset();
    sendPushToUser.mockReset();
    process.env.CRON_SECRET = "test-secret";
    updateNotification.mockResolvedValue({});
  });

  it("401s without the correct bearer token", async () => {
    const res = await GET({ headers: { get: () => "Bearer wrong" } } as unknown as Request);
    expect(res.status).toBe(401);
    expect(findManyNotification).not.toHaveBeenCalled();
  });

  it("sends a PUSH row with a badgeCount one higher than the current unread count, and marks it SENT", async () => {
    findManyNotification.mockResolvedValue([
      {
        id: "notif-1",
        userId: "user-1",
        channel: "PUSH",
        type: "PAYOUT_TURN",
        message: "It's your turn!",
        actionUrl: "/sessions/session-1",
        retryCount: 0,
        user: { email: null, phone: null },
      },
    ]);
    notificationCount.mockResolvedValue(2);
    sendPushToUser.mockResolvedValue({ sent: 1, failed: 0 });

    const res = await GET(fakeCronRequest());
    const body = await res.json();

    expect(body).toEqual({ ok: true, processed: 1, sent: 1, failed: 0 });
    expect(sendPushToUser).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ body: "It's your turn!", url: "/sessions/session-1", badgeCount: 3 }),
    );
    expect(updateNotification).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "notif-1" }, data: expect.objectContaining({ status: "SENT" }) }),
    );
  });

  it("marks a PUSH row SENT even when every device delivery failed — sendPushToUser is best-effort, not retried like EMAIL/WHATSAPP", async () => {
    findManyNotification.mockResolvedValue([
      {
        id: "notif-2",
        userId: "user-1",
        channel: "PUSH",
        type: "PAYMENT_SUCCESS",
        message: "Payment received",
        actionUrl: null,
        retryCount: 0,
        user: { email: null, phone: null },
      },
    ]);
    notificationCount.mockResolvedValue(0);
    sendPushToUser.mockResolvedValue({ sent: 0, failed: 2 });

    const res = await GET(fakeCronRequest());
    const body = await res.json();

    expect(body.sent).toBe(1);
    expect(body.failed).toBe(0);
    const finalCall = updateNotification.mock.calls.find((c) => c[0].data.status === "SENT");
    expect(finalCall).toBeDefined();
  });

  it("still sends EMAIL and WHATSAPP notifications the same as before", async () => {
    findManyNotification.mockResolvedValue([
      {
        id: "notif-email",
        userId: "user-1",
        channel: "EMAIL",
        type: "CONTRIBUTION_REMINDER",
        message: "reminder",
        actionUrl: null,
        retryCount: 0,
        user: { email: "a@example.com", phone: null },
      },
    ]);
    sendEmail.mockResolvedValue({});

    const res = await GET(fakeCronRequest());
    const body = await res.json();

    expect(body.sent).toBe(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendPushToUser).not.toHaveBeenCalled();
  });
});
