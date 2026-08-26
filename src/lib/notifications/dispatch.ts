import { prisma } from "@/lib/prisma";
import type { NotificationChannel, NotificationEventType } from "@/generated/prisma/enums";

const STAGGER_MS = 5 * 60 * 1000;

export interface NotificationRecipient {
  userId: string;
  message: string;
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
      status: "SCHEDULED" as const,
      scheduledAt: new Date(now + index * STAGGER_MS),
    })),
  });

  return params.recipients.length;
}
