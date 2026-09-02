import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email/resend";
import { sendWhatsAppMessage } from "@/lib/whatsapp/evolution";
import { sendPushToUser } from "@/lib/push/send";

const MAX_RETRIES = 3;
const BATCH_SIZE = 25;

/**
 * Runs every minute (see vercel.json) and dispatches whatever's due from
 * the Notification queue — this is what actually makes the 5-minute
 * stagger real: scheduleNotifications() only writes rows with a future
 * scheduledAt, this cron is the only thing that ever sends anything, so
 * delivery survives the admin closing their browser.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const due = await prisma.notification.findMany({
    where: { status: { in: ["PENDING", "SCHEDULED"] }, scheduledAt: { lte: new Date() } },
    include: { user: { select: { email: true, phone: true } } },
    orderBy: { scheduledAt: "asc" },
    take: BATCH_SIZE,
  });

  let sent = 0;
  let failed = 0;

  for (const n of due) {
    await prisma.notification.update({ where: { id: n.id }, data: { status: "PROCESSING" } });

    try {
      if (n.channel === "EMAIL") {
        if (!n.user.email) throw new Error("Recipient has no email on file");
        const { subject, body } = splitSubjectAndBody(n.type, n.message);
        await sendEmail(n.user.email, subject, htmlFor(body));
      } else if (n.channel === "WHATSAPP") {
        if (!n.user.phone) throw new Error("Recipient has no WhatsApp number on file");
        await sendWhatsAppMessage(n.user.phone, n.message);
      } else if (n.channel === "PUSH") {
        // +1 because this row's own status flips to SENT right after this
        // block — it isn't counted yet by the same query the badge-sync
        // endpoint uses, so the service worker would otherwise set the
        // badge one notification behind.
        const badgeCount =
          (await prisma.notification.count({
            where: { userId: n.userId, status: { in: ["SENT", "FAILED"] }, readAt: null },
          })) + 1;
        // Best-effort across every device this user has subscribed on —
        // never throws, so a push failure never retries the whole row the
        // way an EMAIL/WHATSAPP API error does (there's nothing more to
        // retry once every known subscription has already been tried).
        await sendPushToUser(n.userId, {
          title: subjectFor(n.type),
          body: n.message,
          url: n.actionUrl ?? undefined,
          badgeCount,
        });
      }
      // IN_APP has no external delivery — the row itself is the message.

      await prisma.notification.update({
        where: { id: n.id },
        data: { status: "SENT", sentAt: new Date() },
      });
      sent++;
    } catch (error) {
      const retryCount = n.retryCount + 1;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      await prisma.notification.update({
        where: { id: n.id },
        data:
          retryCount >= MAX_RETRIES
            ? { status: "FAILED", retryCount, errorMessage }
            : // Give it another shot on a future run instead of burning it —
              // re-scheduled 2 minutes out so a transient outage clears itself.
              { status: "SCHEDULED", retryCount, errorMessage, scheduledAt: new Date(Date.now() + 2 * 60 * 1000) },
      });
      failed++;
    }
  }

  return NextResponse.json({ ok: true, processed: due.length, sent, failed });
}

function subjectFor(type: string): string {
  switch (type) {
    case "CONTRIBUTION_REMINDER":
      return "Contribution Reminder";
    case "FINE_REMINDER":
      return "Fine Reminder";
    case "FOOD_TURN":
      return "It's your turn! 🎉";
    default:
      return "DIVA Association";
  }
}

/** ADMIN_BROADCAST messages are stored as "subject\n\nbody" (see broadcast-email/route.ts) — every other type has no admin-chosen subject, so it falls back to a type label. */
function splitSubjectAndBody(type: string, message: string): { subject: string; body: string } {
  if (type === "ADMIN_BROADCAST") {
    const [subject, ...rest] = message.split("\n\n");
    return { subject, body: rest.join("\n\n") || subject };
  }
  return { subject: subjectFor(type), body: message };
}

function htmlFor(message: string): string {
  return message
    .split("\n")
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
