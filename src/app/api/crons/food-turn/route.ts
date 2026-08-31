import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { TontineType } from "@/generated/prisma/enums";
import { isContributionDay, toDueDateKey } from "@/lib/tontine-engine";
import { getDesignatedSlot } from "@/lib/round-robin-lock";
import { translate } from "@/lib/i18n/translations";
import { scheduleNotifications } from "@/lib/notifications/dispatch";
import { sendWhatsAppMessageSafe } from "@/lib/whatsapp/evolution";
import { sendEmailSafe } from "@/lib/email/resend";

const ALL_TONTINE_TYPES: TontineType[] = ["HEBDO_SUNDAY", "MONTHLY_25", "MONTHLY_28"];

/**
 * Notifies whoever's turn it is to receive the "food"/payout this cycle —
 * WhatsApp + email sent directly here (immediate, not staggered — this is
 * a single recipient, not a bulk admin broadcast), plus an IN_APP
 * Notification row for their "My Notifications" feed. Idempotent via
 * FoodTurnLog, same unique-constraint-catch pattern as the existing daily
 * reminder crons.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  let notified = 0;

  for (const type of ALL_TONTINE_TYPES) {
    if (!isContributionDay(type, now)) continue;
    const dueDate = toDueDateKey(now);

    const sessions = await prisma.tontineSession.findMany({ where: { type, status: "ACTIVE" } });
    for (const tontineSession of sessions) {
      const designatedSlot = await getDesignatedSlot(tontineSession.id);
      if (!designatedSlot) continue;

      const log = await prisma.foodTurnLog
        .create({ data: { membershipSlotId: designatedSlot.id, dueDate } })
        .catch(() => null); // unique violation = already notified for this cycle
      if (!log) continue;

      const membership = await prisma.membership.findUnique({
        where: { id: designatedSlot.membershipId },
        include: { user: true },
      });
      if (!membership) continue;

      const lang = membership.user.preferredLang === "fr" ? "fr" : "en";
      const message = translate(lang, "foodTurnMessage", { name: membership.user.name });

      await sendWhatsAppMessageSafe(membership.user.phone, message);
      await sendEmailSafe(membership.user.email, "It's your turn! 🎉", message.split("\n").map((l) => `<p>${l}</p>`).join(""));
      await scheduleNotifications({
        tontineSessionId: tontineSession.id,
        channel: "IN_APP",
        type: "FOOD_TURN",
        recipients: [
          {
            userId: membership.userId,
            message,
            messageKey: "foodTurnMessage",
            messageVars: { name: membership.user.name },
          },
        ],
      });
      // IN_APP rows created via scheduleNotifications default to SCHEDULED,
      // but there's nothing for the cron to "send" for IN_APP — flip it
      // straight to SENT so it shows up in the user's feed immediately.
      await prisma.notification.updateMany({
        where: { tontineSessionId: tontineSession.id, userId: membership.userId, type: "FOOD_TURN", status: "SCHEDULED" },
        data: { status: "SENT", sentAt: new Date() },
      });

      notified++;
    }
  }

  return NextResponse.json({ ok: true, notified });
}
