import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveSessionsDueToday, getUnpaidSlots } from "@/lib/notify";
import { getContributionTotal } from "@/lib/tontine-engine";
import { reminderUrgentMessage } from "@/lib/whatsapp/templates";
import { formatXAF } from "@/lib/format-currency";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";

export const maxDuration = 60;

/**
 * Cron: Urgent Reminder (17h00 WAT / 16:00 UTC on contribution day).
 * Strictly targets ONLY members who have NOT yet contributed before the 18:30 deadline.
 * Dispatches In-App notification, Web Push to phone, and Branded Email.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const dueSessions = await getActiveSessionsDueToday(now);
  let sent = 0;

  for (const { tontineSession, dueDate } of dueSessions) {
    const { amount } = getContributionTotal({
      amount: Number(tontineSession.amount),
      fee: Number(tontineSession.fee),
    });
    const unpaid = await getUnpaidSlots(tontineSession.id, dueDate);
    const sessionTitle = tontineSession.title || tontineSession.type;

    const processedUsers = new Set<string>();

    for (const slot of unpaid) {
      if (processedUsers.has(slot.userId)) continue;
      processedUsers.add(slot.userId);

      const log = await prisma.notificationLog
        .create({
          data: {
            userId: slot.userId,
            tontineSessionId: tontineSession.id,
            dueDate,
            type: "REMINDER_URGENT",
          },
        })
        .catch(() => null);
      if (!log) continue;

      const lang = slot.user.preferredLang === "en" ? "en" : "fr";
      const rawName = slot.user.name?.trim() || "";
      const firstName = rawName.split(/\s+/)[0] || rawName;
      const message = reminderUrgentMessage(lang, firstName, tontineSession.type, amount, sessionTitle);

      await scheduleInAppNotifications({
        tontineSessionId: tontineSession.id,
        type: "CONTRIBUTION_REMINDER",
        recipients: [
          {
            userId: slot.userId,
            message,
            messageKey: "waReminderUrgent",
            messageVars: {
              name: firstName,
              amount: formatXAF(amount),
              cotisation: sessionTitle,
            },
            actionUrl: `/sessions/${tontineSession.id}`,
          },
        ],
      });

      sent++;
    }
  }

  return NextResponse.json({ ok: true, sent });
}
