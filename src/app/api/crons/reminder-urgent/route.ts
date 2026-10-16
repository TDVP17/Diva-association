import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveSessionsDueToday, getUnpaidSlots } from "@/lib/notify";
import { getContributionTotal } from "@/lib/tontine-engine";
import { sendEmailSafe } from "@/lib/email/resend";
import { renderBrandedEmailHtml } from "@/lib/email/template";
import { reminderUrgentMessage } from "@/lib/whatsapp/templates";
import { translate } from "@/lib/i18n/translations";
import { formatXAF } from "@/lib/format-currency";

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

    for (const slot of unpaid) {
      if (!slot.user.phone && !slot.user.email) continue;

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
      const message = reminderUrgentMessage(lang, slot.user.name, tontineSession.type, amount);

      if (slot.user.email) {
        const subject = `⚠️ ${translate(lang, "notifTypeContributionReminder")} — ${tontineSession.title || tontineSession.type}`;
        const emailHtml = renderBrandedEmailHtml({
          title: subject,
          bodyText: message,
          actionUrl: `/sessions/${tontineSession.id}`,
          actionLabel: `Payer maintenant (${formatXAF(amount)})`,
          lang,
        });
        await sendEmailSafe(slot.user.email, subject, emailHtml);
      }
      sent++;
    }
  }

  return NextResponse.json({ ok: true, sent });
}
