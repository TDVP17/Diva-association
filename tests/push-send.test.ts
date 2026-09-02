import { describe, it, expect, vi, beforeEach } from "vitest";

const findManySubscription = vi.fn();
const deleteSubscription = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    pushSubscription: {
      findMany: (...a: unknown[]) => findManySubscription(...a),
      delete: (...a: unknown[]) => deleteSubscription(...a),
    },
  },
}));

const setVapidDetails = vi.fn();
const sendNotification = vi.fn();
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: (...a: unknown[]) => setVapidDetails(...a),
    sendNotification: (...a: unknown[]) => sendNotification(...a),
  },
}));

const ORIGINAL_ENV = { ...process.env };

describe("sendPushToUser", () => {
  beforeEach(() => {
    vi.resetModules();
    findManySubscription.mockReset();
    deleteSubscription.mockReset();
    setVapidDetails.mockReset();
    sendNotification.mockReset();
    process.env = { ...ORIGINAL_ENV };
  });

  it("returns {sent:0, failed:0} without querying anything when VAPID env vars aren't configured", async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { sendPushToUser } = await import("@/lib/push/send");
    const result = await sendPushToUser("user-1", { title: "Hi", body: "there" });

    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(findManySubscription).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("returns {sent:0, failed:0} when the user has no subscriptions", async () => {
    process.env.VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_KEY = "priv";
    process.env.VAPID_SUBJECT = "mailto:test@example.com";
    findManySubscription.mockResolvedValue([]);

    const { sendPushToUser } = await import("@/lib/push/send");
    const result = await sendPushToUser("user-1", { title: "Hi", body: "there" });

    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("sends to every subscription the user has, and reports the count", async () => {
    process.env.VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_KEY = "priv";
    process.env.VAPID_SUBJECT = "mailto:test@example.com";
    findManySubscription.mockResolvedValue([
      { id: "sub-1", endpoint: "https://push.example/1", p256dh: "a", auth: "b" },
      { id: "sub-2", endpoint: "https://push.example/2", p256dh: "c", auth: "d" },
    ]);
    sendNotification.mockResolvedValue({});

    const { sendPushToUser } = await import("@/lib/push/send");
    const result = await sendPushToUser("user-1", { title: "Hi", body: "there", badgeCount: 3 });

    expect(result).toEqual({ sent: 2, failed: 0 });
    expect(sendNotification).toHaveBeenCalledTimes(2);
    const [subArg, bodyArg] = sendNotification.mock.calls[0];
    expect(subArg).toEqual({ endpoint: "https://push.example/1", keys: { p256dh: "a", auth: "b" } });
    expect(JSON.parse(bodyArg)).toMatchObject({ title: "Hi", body: "there", badgeCount: 3 });
  });

  it("deletes a subscription that comes back 410 Gone, but doesn't fail the whole batch", async () => {
    process.env.VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_KEY = "priv";
    process.env.VAPID_SUBJECT = "mailto:test@example.com";
    findManySubscription.mockResolvedValue([
      { id: "sub-dead", endpoint: "https://push.example/dead", p256dh: "a", auth: "b" },
      { id: "sub-alive", endpoint: "https://push.example/alive", p256dh: "c", auth: "d" },
    ]);
    deleteSubscription.mockResolvedValue({});
    sendNotification.mockImplementation((sub: { endpoint: string }) => {
      if (sub.endpoint.includes("dead")) {
        const err = new Error("Gone") as Error & { statusCode: number };
        err.statusCode = 410;
        return Promise.reject(err);
      }
      return Promise.resolve({});
    });

    const { sendPushToUser } = await import("@/lib/push/send");
    const result = await sendPushToUser("user-1", { title: "Hi", body: "there" });

    expect(result).toEqual({ sent: 1, failed: 1 });
    expect(deleteSubscription).toHaveBeenCalledWith({ where: { id: "sub-dead" } });
  });

  it("leaves a subscription alone on a transient failure (not 404/410)", async () => {
    process.env.VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_KEY = "priv";
    process.env.VAPID_SUBJECT = "mailto:test@example.com";
    findManySubscription.mockResolvedValue([
      { id: "sub-1", endpoint: "https://push.example/1", p256dh: "a", auth: "b" },
    ]);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    sendNotification.mockRejectedValue(Object.assign(new Error("Service unavailable"), { statusCode: 503 }));

    const { sendPushToUser } = await import("@/lib/push/send");
    const result = await sendPushToUser("user-1", { title: "Hi", body: "there" });

    expect(result).toEqual({ sent: 0, failed: 1 });
    expect(deleteSubscription).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
