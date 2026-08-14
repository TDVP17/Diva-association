import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveSessionsDueToday, getUnpaidMembers } from "@/lib/notify";
import { getContributionTotal } from "@/lib/tontine-engine";
import { sendWhatsAppMessageSafe } from "@/lib/whatsapp/evolution";
import { reminderUrgentMessage } from "@/lib/whatsapp/templates";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const dueSessions = await getActiveSessionsDueToday(now);
  let sent = 0;

  for (const { tontineSession, dueDate } of dueSessions) {
    const { amount } = getContributionTotal(tontineSession.type);
    const unpaid = await getUnpaidMembers(tontineSession.id, dueDate);

    for (const membership of unpaid) {
      if (!membership.user.phone) continue;

      const log = await prisma.notificationLog
        .create({
          data: {
            userId: membership.userId,
            tontineSessionId: tontineSession.id,
            dueDate,
            type: "REMINDER_URGENT",
          },
        })
        .catch(() => null);
      if (!log) continue;

      await sendWhatsAppMessageSafe(
        membership.user.phone,
        reminderUrgentMessage(membership.user.name, tontineSession.type, amount),
      );
      sent++;
    }
  }

  return NextResponse.json({ ok: true, sent });
}
