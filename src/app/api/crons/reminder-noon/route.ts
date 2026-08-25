import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveSessionsDueToday, getUnpaidSlots } from "@/lib/notify";
import { getContributionTotal } from "@/lib/tontine-engine";
import { sendWhatsAppMessageSafe } from "@/lib/whatsapp/evolution";
import { reminderNoonMessage } from "@/lib/whatsapp/templates";

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
      if (!slot.user.phone) continue;

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

      await sendWhatsAppMessageSafe(
        slot.user.phone,
        reminderNoonMessage(slot.user.name, tontineSession.type, amount),
      );
      sent++;
    }
  }

  return NextResponse.json({ ok: true, sent });
}
