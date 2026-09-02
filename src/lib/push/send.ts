import webpush from "web-push";
import { prisma } from "@/lib/prisma";

let configured = false;

function ensureConfigured(): boolean {
  if (configured) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    console.error(
      "[push] VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, or VAPID_SUBJECT is not configured — push notifications cannot be sent. " +
        "Generate a key pair with `npx web-push generate-vapid-keys` and set all three env vars " +
        "(VAPID_SUBJECT is a mailto: or https: contact URL).",
    );
    return false;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Client-side navigation target on tap — same convention as Notification.actionUrl. */
  url?: string;
  /** Current unread count at send time, so the service worker can set the app badge directly without a round trip. */
  badgeCount?: number;
}

/**
 * Sends one Web Push message to every device this user has subscribed on
 * (a user can have several — phone + desktop). Best-effort per subscription:
 * a dead/expired subscription (410 Gone, or 404) is deleted so it stops
 * being retried, but never fails the batch for the others. Never throws —
 * the caller (the notification cron) always has other channels/rows to
 * process and shouldn't abort over one user's push delivery.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<{ sent: number; failed: number }> {
  if (!ensureConfigured()) return { sent: 0, failed: 0 };

  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } });
  if (subscriptions.length === 0) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;
  const body = JSON.stringify(payload);

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
        );
        sent++;
      } catch (err) {
        failed++;
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          // The push service says this subscription is gone for good —
          // stop retrying it. Any other status (network blip, 5xx from the
          // push service) is left alone for the next notification to retry.
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        } else {
          console.error(`[push] delivery failed for subscription ${sub.id}:`, err);
        }
      }
    }),
  );

  return { sent, failed };
}
