import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveSessionsDueToday, getUnpaidSlots } from "@/lib/notify";
import { getContributionTotal } from "@/lib/tontine-engine";
import { sendWhatsAppMessageSafe } from "@/lib/whatsapp/evolution";
import { sendEmailSafe } from "@/lib/email/resend";
import { reminderNoonMessage } from "@/lib/whatsapp/templates";
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

    // NotificationLog is still one row per (user, session, cycle, type) — a
    // member with several unpaid slots gets one reminder, not one per slot,
    // enforced naturally by the unique-constraint catch below (only the
    // first unpaid slot found for a given user actually sends/logs).
    for (const slot of unpaid) {
      if (!slot.user.phone && !slot.user.email) continue;

      const log = await prisma.notificationLog
        .create({
          data: {
            userId: slot.userId,
            tontineSessionId: tontineSession.id,
            dueDate,
            type: "REMINDER_NOON",
          },
        })
        .catch(() => null); // unique violation = already sent for this cycle
      if (!log) continue;

      const lang = slot.user.preferredLang === "en" ? "en" : "fr";
      const message = reminderNoonMessage(lang, slot.user.name, tontineSession.type, amount);

      if (slot.user.phone) {
        await sendWhatsAppMessageSafe(slot.user.phone, message);
      }
      if (slot.user.email) {
        const subject = `${translate(lang, "notifTypeContributionReminder")} — ${tontineSession.title || tontineSession.type}`;
        const emailHtml = `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0;">
            <div style="text-align: center; margin-bottom: 20px;">
              <h2 style="color: #003528; margin: 0;">DIVA Asso</h2>
            </div>
            <h3 style="color: #0f172a; margin-top: 0;">${subject}</h3>
            <p style="font-size: 15px; line-height: 1.6; white-space: pre-line;">${message}</p>
            <p style="margin-top: 24px;">
              <a href="${process.env.NEXTAUTH_URL ?? "https://diva-association.vercel.app"}/sessions/${tontineSession.id}" style="background-color: #003528; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Cotiser maintenant (${formatXAF(amount)})</a>
            </p>
          </div>
        `;
        await sendEmailSafe(slot.user.email, subject, emailHtml);
      }
      sent++;
    }
  }

  return NextResponse.json({ ok: true, sent });
}
