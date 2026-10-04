import { prisma } from "@/lib/prisma";
import type { NotificationChannel, NotificationEventType } from "@/generated/prisma/enums";
import { sendPushToUser } from "@/lib/push/send";
import { sendWhatsAppMessageSafe } from "@/lib/whatsapp/evolution";
import { sendEmailSafe } from "@/lib/email/resend";
import { NOTIFICATION_TYPE_KEY } from "@/lib/notifications/type-labels";
import { translate, type Lang } from "@/lib/i18n/translations";

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

  // Deduplicate: ignore identical notifications scheduled within 10 minutes
  let uniqueRecipients = params.recipients;
  if (typeof prisma?.notification?.findMany === "function") {
    const userIds = params.recipients.map((r) => r.userId);
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    const existingRecent = await prisma.notification.findMany({
      where: {
        userId: { in: userIds },
        tontineSessionId: params.tontineSessionId,
        channel: params.channel,
        type: params.type,
        createdAt: { gte: tenMinutesAgo },
      },
      select: { userId: true },
    });

    const recentUserIds = new Set(existingRecent.map((n) => n.userId));
    uniqueRecipients = params.recipients.filter((r) => !recentUserIds.has(r.userId));
  }

  if (uniqueRecipients.length === 0) return 0;

  const now = Date.now();
  await prisma.notification.createMany({
    data: uniqueRecipients.map((r, index) => ({
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

  return uniqueRecipients.length;
}

/**
 * Delivers immediate background notifications to user's phone via Web Push,
 * WhatsApp (Evolution API), and Email (Resend) so members receive alerts even
 * when the app is closed or in the background. Never blocks the calling request handler.
 */
async function deliverInstantNotifications(params: {
  type: NotificationEventType;
  recipients: NotificationRecipient[];
}): Promise<void> {
  try {
    const userIds = params.recipients.map((r) => r.userId);
    const users = prisma.user?.findMany
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true, phone: true, preferredLang: true },
        })
      : [];

    const userMap = new Map(users.map((u) => [u.id, u]));
    const baseUrl = process.env.NEXTAUTH_URL ?? "https://diva-association.vercel.app";

    await Promise.all(
      params.recipients.map(async (r) => {
        const user = userMap.get(r.userId);
        const lang: Lang = user?.preferredLang === "en" ? "en" : "fr";
        const typeKey = NOTIFICATION_TYPE_KEY[params.type];
        let title = typeKey ? translate(lang, typeKey) : "DIVA Asso.";
        let body = r.message;

        if (params.type === "ADMIN_BROADCAST" && r.message.includes("\n\n")) {
          const [parsedSubject, ...rest] = r.message.split("\n\n");
          if (parsedSubject?.trim()) {
            title = parsedSubject.trim();
            body = rest.join("\n\n").trim() || body;
          }
        }

        // 1. Deliver instant Web Push to phone
        try {
          const badgeCount =
            typeof prisma?.notification?.count === "function"
              ? (await prisma.notification.count({
                  where: { userId: r.userId, channel: "IN_APP", status: { in: ["SENT", "FAILED"] }, readAt: null },
                })) || 1
              : 1;

          await sendPushToUser(r.userId, {
            title,
            body,
            url: r.actionUrl,
            badgeCount,
          });
        } catch (pushErr) {
          console.error("[push] instant delivery failed:", pushErr);
        }

        // 2. Deliver instant WhatsApp message via Evolution API
        if (user?.phone) {
          try {
            const link = r.actionUrl ? `\n\nConsulter : ${baseUrl}${r.actionUrl}` : "";
            const waText = `*${title}*\n\n${body}${link}`;
            await sendWhatsAppMessageSafe(user.phone, waText);
          } catch (waErr) {
            console.error("[whatsapp] instant delivery failed:", waErr);
          }
        }

        // 3. Deliver instant Email notification via Resend
        if (user?.email) {
          try {
            const actionButton = r.actionUrl
              ? `<p style="margin-top: 24px;"><a href="${baseUrl}${r.actionUrl}" style="background-color: #003528; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Consulter</a></p>`
              : "";
            const emailHtml = `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0;">
                <div style="text-align: center; margin-bottom: 24px;">
                  <h2 style="color: #003528; margin: 0; font-size: 22px;">DIVA Asso.</h2>
                </div>
                <h3 style="color: #0f172a; margin-top: 0; font-size: 18px;">${title}</h3>
                <p style="font-size: 15px; line-height: 1.6; white-space: pre-line; color: #334155;">${body}</p>
                ${actionButton}
                <hr style="margin: 32px 0 16px; border: none; border-top: 1px solid #e2e8f0;" />
                <p style="font-size: 12px; color: #94a3b8; text-align: center; margin: 0;">DIVA Asso. — Plateforme de gestion des cotisations</p>
              </div>
            `;
            await sendEmailSafe(user.email, title, emailHtml);
          } catch (emailErr) {
            console.error("[email] instant delivery failed:", emailErr);
          }
        }
      }),
    );
  } catch (err) {
    console.error("[notifications] deliverInstantNotifications failed:", err);
  }
}

/**
 * IN_APP notifications have nothing for the process-notifications cron to
 * "send" — the row itself is the message. This schedules them the normal
 * way, then immediately flips the just-created rows to SENT so they show
 * up in the recipients' notification feed right away instead of waiting on
 * the cron. Mirrors the pattern first used in the membership approve/reject
 * route, now shared so every IN_APP trigger site behaves consistently.
 *
 * Every IN_APP event also gets companion PUSH, WHATSAPP, and EMAIL rows for the same
 * recipients — reaching members directly on their phone even when the app is
 * closed, via system push, WhatsApp (Evolution API), and Email (Resend).
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
  await scheduleNotifications({ ...params, channel: "WHATSAPP" });
  await scheduleNotifications({ ...params, channel: "EMAIL" });

  // Trigger instant phone delivery (Push & WhatsApp & Email) in background
  void deliverInstantNotifications(params);

  return count;
}

