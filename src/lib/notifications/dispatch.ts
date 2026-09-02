import { prisma } from "@/lib/prisma";
import type { NotificationChannel, NotificationEventType } from "@/generated/prisma/enums";

const STAGGER_MS = 5 * 60 * 1000;

export interface NotificationRecipient {
  userId: string;
  message: string;
  /** Where tapping this notification in the feed should navigate to, e.g. "/chat". */
  actionUrl?: string;
  /**
   * i18n key (see src/lib/i18n/translations.ts) letting IN_APP rows render
   * in whichever language is currently selected, instead of being stuck in
   * whatever language `message` was rendered in at creation time. Ignored
   * for EMAIL/WHATSAPP, which always send the pre-rendered `message`.
   */
  messageKey?: string;
  messageVars?: Record<string, string>;
}

/**
 * Creates one Notification row per recipient, staggered 5 minutes apart
 * starting from now (recipient 0 fires immediately once the cron picks it
 * up, recipient 1 five minutes later, etc). Message text is rendered by
 * the caller BEFORE this runs (not at send time), so content stays stable
 * even if member data changes before the cron dispatches it. Actual
 * delivery happens asynchronously via /api/crons/process-notifications —
 * this function only enqueues, it never sends anything itself, so it's
 * safe to call from a request handler without blocking on WhatsApp/email.
 */
export async function scheduleNotifications(params: {
  tontineSessionId?: string;
  channel: NotificationChannel;
  type: NotificationEventType;
  recipients: NotificationRecipient[];
}): Promise<number> {
  if (params.recipients.length === 0) return 0;

  const now = Date.now();
  await prisma.notification.createMany({
    data: params.recipients.map((r, index) => ({
      tontineSessionId: params.tontineSessionId,
      userId: r.userId,
      channel: params.channel,
      type: params.type,
      message: r.message,
      messageKey: r.messageKey,
      messageVars: r.messageVars,
      actionUrl: r.actionUrl,
      status: "SCHEDULED" as const,
      scheduledAt: new Date(now + index * STAGGER_MS),
    })),
  });

  return params.recipients.length;
}

/**
 * IN_APP notifications have nothing for the process-notifications cron to
 * "send" — the row itself is the message. This schedules them the normal
 * way, then immediately flips the just-created rows to SENT so they show
 * up in the recipients' notification feed right away instead of waiting on
 * the cron. Mirrors the pattern first used in the membership approve/reject
 * route, now shared so every IN_APP trigger site behaves consistently.
 *
 * Every IN_APP event also gets a companion PUSH row for the same
 * recipients — this is what actually reaches a member while the app is
 * closed/backgrounded (see the service worker's `push` handler and
 * src/lib/push/send.ts). Unlike the IN_APP row, the PUSH row is left
 * SCHEDULED for the cron to pick up normally: sending it is a real network
 * call (to each of the recipient's push subscriptions), not just a DB
 * write, so it can't be resolved synchronously the way IN_APP is.
 */
export async function scheduleInAppNotifications(params: {
  tontineSessionId?: string;
  type: NotificationEventType;
  recipients: NotificationRecipient[];
}): Promise<number> {
  const count = await scheduleNotifications({ ...params, channel: "IN_APP" });
  if (count === 0) return 0;

  await prisma.notification.updateMany({
    where: {
      userId: { in: params.recipients.map((r) => r.userId) },
      tontineSessionId: params.tontineSessionId,
      type: params.type,
      channel: "IN_APP",
      status: "SCHEDULED",
    },
    data: { status: "SENT", sentAt: new Date() },
  });

  await scheduleNotifications({ ...params, channel: "PUSH" });

  return count;
}
