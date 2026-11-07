import { prisma } from "@/lib/prisma";
import { getUnreadInAppNotificationCount } from "@/lib/notifications/unread";
import type { NotificationChannel, NotificationEventType } from "@/generated/prisma/enums";
import { sendPushToUser } from "@/lib/push/send";
import { sendEmailSafe } from "@/lib/email/resend";
import { renderBrandedEmailHtml } from "@/lib/email/template";
import { NOTIFICATION_TYPE_KEY } from "@/lib/notifications/type-labels";
import { translate, translations, type Lang, type TranslationKey } from "@/lib/i18n/translations";

// 3-minute stagger for outgoing broadcast messages to prevent email spam flags
export const STAGGER_MS = 3 * 60 * 1000;

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
  staggerMs?: number;
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

  // Retrieve user names and preferred languages to personalize message prefix
  const recipientUserIds = uniqueRecipients.map((r) => r.userId);
  const usersForPersonalization = prisma.user?.findMany
    ? await prisma.user.findMany({
        where: { id: { in: recipientUserIds } },
        select: { id: true, name: true, preferredLang: true },
      })
    : [];
  const userGreetingMap = new Map(usersForPersonalization.map((u) => [u.id, u]));

  const personalizedRecipients = uniqueRecipients.map((r) => {
    const u = userGreetingMap.get(r.userId);
    const lang: Lang = u?.preferredLang === "en" ? "en" : "fr";
    const rawName = u?.name?.trim() || "";
    const firstName = rawName.split(/\s+/)[0] || rawName;
    const greeting = firstName ? (lang === "en" ? `Hello, ${firstName} 👋` : `Salut, ${firstName} 👋`) : "";

    const vars: Record<string, string> = {
      ...(r.messageVars ?? {}),
      ...(firstName ? { name: firstName } : {}),
    };

    let msg =
      r.messageKey && r.messageKey in translations[lang]
        ? translate(lang, r.messageKey as TranslationKey, vars)
        : r.message;
    const hasGreeting =
      msg.startsWith("Salut") ||
      msg.startsWith("Bonjour") ||
      msg.startsWith("Hello") ||
      msg.startsWith("Hi");

    if (greeting && !hasGreeting) {
      msg = `${greeting} ! ${msg}`;
    }

    return {
      ...r,
      message: msg,
      messageVars: vars,
    };
  });

  const now = Date.now();
  const stepMs = typeof params.staggerMs === "number" && params.staggerMs > 0 ? params.staggerMs : STAGGER_MS;
  await prisma.notification.createMany({
    data: personalizedRecipients.map((r, index) => ({
      tontineSessionId: params.tontineSessionId,
      userId: r.userId,
      channel: params.channel,
      type: params.type,
      message: r.message,
      messageKey: r.messageKey,
      messageVars: r.messageVars,
      actionUrl: r.actionUrl,
      status: "SCHEDULED" as const,
      scheduledAt: new Date(now + index * stepMs),
    })),
  });

  return personalizedRecipients.length;
}

/**
 * Strict daily email limiter (0 FCFA wasted, 0 spam):
 * Enforces a maximum of `maxPerDay` (default: 2) emails per 24 hours per member for:
 * - PAYMENT_FAILED (max 2/day)
 * - CONTRIBUTION_REMINDER (max 2/day)
 * - FINE_REMINDER (max 2/day)
 * If the user has already received 2 emails of this type within the last 24h,
 * email dispatch is skipped. The in-app notification remains visible in the app.
 */
export async function filterRecipientsUnderDailyEmailLimit(
  recipients: NotificationRecipient[],
  type: NotificationEventType,
  maxPerDay: number = 2,
): Promise<NotificationRecipient[]> {
  const rateLimitedTypes: NotificationEventType[] = [
    "PAYMENT_FAILED",
    "CONTRIBUTION_REMINDER",
    "FINE_REMINDER",
  ];
  if (!rateLimitedTypes.includes(type) || recipients.length === 0) {
    return recipients;
  }

  const userIds = recipients.map((r) => r.userId);
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const recentEmails = await prisma.notification.findMany({
    where: {
      userId: { in: userIds },
      type,
      channel: "EMAIL",
      status: { in: ["SENT", "PROCESSING", "SCHEDULED"] },
      createdAt: { gte: oneDayAgo },
    },
    select: { userId: true },
  });

  const countMap = new Map<string, number>();
  for (const n of recentEmails) {
    countMap.set(n.userId, (countMap.get(n.userId) || 0) + 1);
  }

  return recipients.filter((r) => (countMap.get(r.userId) || 0) < maxPerDay);
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
          select: { id: true, email: true, phone: true, preferredLang: true, name: true },
        })
      : [];

    const userMap = new Map(users.map((u) => [u.id, u]));
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "https://www.divaasso.com";

    for (let i = 0; i < params.recipients.length; i += 5) {
      const batch = params.recipients.slice(i, i + 5);
      await Promise.all(
        batch.map(async (r) => {
          const user = userMap.get(r.userId);
          const lang: Lang = user?.preferredLang === "en" ? "en" : "fr";
          const rawName = user?.name?.trim() || "";
          const firstName = rawName.split(/\s+/)[0] || rawName;
          const greeting = firstName ? (lang === "en" ? `Hello, ${firstName} 👋` : `Salut, ${firstName} 👋`) : "";
          const typeKey = NOTIFICATION_TYPE_KEY[params.type];
          let title = typeKey ? translate(lang, typeKey) : "DIVA Asso.";
          const vars: Record<string, string> = {
            ...(r.messageVars ?? {}),
            ...(firstName ? { name: firstName } : {}),
          };
          let body =
            r.messageKey && r.messageKey in translations[lang]
              ? translate(lang, r.messageKey as TranslationKey, vars)
              : r.message;

          // Ensure push/body begins with personalized greeting with emoji
          const hasGreeting =
            body.startsWith("Salut") ||
            body.startsWith("Bonjour") ||
            body.startsWith("Hello") ||
            body.startsWith("Hi");

          if (greeting && !hasGreeting) {
            body = `${greeting} ! ${body}`;
          }

          if (params.type === "ADMIN_BROADCAST" && r.message.includes("\n\n")) {
            const [parsedSubject, ...rest] = r.message.split("\n\n");
            if (parsedSubject?.trim()) {
              title = parsedSubject.trim();
              body = rest.join("\n\n").trim() || body;
            }
          }

          // 1. Deliver instant Web Push to phone
          try {
            const badgeCount = (await getUnreadInAppNotificationCount(r.userId)) || 1;

            await sendPushToUser(r.userId, {
              title,
              body,
              url: r.actionUrl,
              badgeCount,
            });
          } catch (pushErr) {
            console.error("[push] instant delivery failed:", pushErr);
          }

          // Deliver instant Email notification via Resend with official DIVA logo and direct CTA button.
          // For broadcast or multi-recipient events (ADMIN_BROADCAST, DRAW_LAUNCHED, CONTRIBUTION_REMINDER, FINE_REMINDER, or >1 recipients),
          // DO NOT blast emails simultaneously here!
          // They are queued with 3 minutes of spacing (STAGGER_MS) between each recipient so email providers (Gmail, Yahoo)
          // never flag them as bulk spam, and members never receive duplicate emails.
          const isBroadcastOrGroup =
            params.type === "ADMIN_BROADCAST" ||
            params.type === "DRAW_LAUNCHED" ||
            params.type === "CONTRIBUTION_REMINDER" ||
            params.type === "FINE_REMINDER" ||
            params.recipients.length > 1;

          // NEVER send companion transactional email here for PAYMENT_SUCCESS:
          // The official payment receipt email with downloadable PDF is already sent by settleContribution / settleBulkPayment.
          const isPaymentSuccess = params.type === "PAYMENT_SUCCESS";

          if (user?.email && !isBroadcastOrGroup && !isPaymentSuccess) {
            try {
              const emailHtml = renderBrandedEmailHtml({
                title,
                bodyText: body,
                actionUrl: r.actionUrl,
                actionLabel: lang === "en" ? "View in App" : "Consulter dans l'application",
                lang,
                baseUrl,
                recipientName: user.name,
              });
              await sendEmailSafe(user.email, title, emailHtml);

              // Mark the scheduled EMAIL row as SENT immediately so the background queue never re-sends a duplicate!
              await prisma.notification.updateMany({
                where: {
                  userId: r.userId,
                  channel: "EMAIL",
                  type: params.type,
                  status: "SCHEDULED",
                },
                data: { status: "SENT", sentAt: new Date() },
              });
            } catch (emailErr) {
              console.error("[email] instant delivery failed:", emailErr);
            }
          }
        }),
      );
      if (i + 5 < params.recipients.length) {
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
    }
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
 * Every IN_APP event also gets companion PUSH and EMAIL rows for the same
 * recipients — reaching members directly via Web Push and Email (Resend).
 */
export async function scheduleInAppNotifications(params: {
  tontineSessionId?: string;
  type: NotificationEventType;
  recipients: NotificationRecipient[];
  staggerMs?: number;
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

  // Companion Web Push (staggered by stepMs)
  await scheduleNotifications({ ...params, channel: "PUSH" });

  // Companion Email:
  // - Skip completely for PAYMENT_SUCCESS (official receipt PDF email already sent).
  // - For all other types, strictly enforce max 2 emails / 24h per member for failures and reminders.
  if (params.type !== "PAYMENT_SUCCESS") {
    const eligibleEmailRecipients = await filterRecipientsUnderDailyEmailLimit(
      params.recipients,
      params.type,
      2,
    );
    if (eligibleEmailRecipients.length > 0) {
      await scheduleNotifications({
        ...params,
        channel: "EMAIL",
        recipients: eligibleEmailRecipients,
      });
    }
  }

  // Trigger instant delivery (Push & transactional email) in background
  void deliverInstantNotifications(params);

  // Trigger immediate dispatch via Supabase Edge Function (0 CPU Vercel)
  // ONLY if this was a broadcast/group with queued recipients!
  const isBroadcastOrGroup =
    params.type === "ADMIN_BROADCAST" ||
    params.type === "DRAW_LAUNCHED" ||
    params.type === "CONTRIBUTION_REMINDER" ||
    params.type === "FINE_REMINDER" ||
    params.recipients.length > 1;

  if (isBroadcastOrGroup) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const cronSecret = process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (supabaseUrl && cronSecret) {
      void fetch(`${supabaseUrl}/functions/v1/send-email?action=process-queue`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cronSecret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "process-queue" }),
      }).catch(() => {});
    }
  }

  return count;
}

