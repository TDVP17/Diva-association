import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isContributionDay, toDueDateKey, ALL_TONTINE_TYPES, isPayoutInfoUnlockTime } from "@/lib/tontine-engine";
import { getDesignatedSlot } from "@/lib/round-robin-lock";
import { translate } from "@/lib/i18n/translations";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import { sendEmailSafe } from "@/lib/email/resend";
import { renderBrandedEmailHtml } from "@/lib/email/template";
import { NOTIFICATION_TYPE_KEY } from "@/lib/notifications/type-labels";

/**
 * Notifies whoever's turn it is to receive the "food"/payout this cycle —
 * Triggered at 18:30 (CUTOFF_HOUR: 18:30) Cameroon time on contribution day,
 * once at least half of the members have contributed and their lucky ball is drawn.
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
    if (!isPayoutInfoUnlockTime(dueDate, now)) continue;

    const sessions = await prisma.tontineSession.findMany({ where: { type, status: "ACTIVE" } });
    for (const tontineSession of sessions) {
      const designatedSlot = await getDesignatedSlot(tontineSession.id);
      if (!designatedSlot || designatedSlot.ballDrawn === null) continue;

      const approvedMemberships = await prisma.membership.findMany({
        where: { tontineSessionId: tontineSession.id, status: "APPROVED" },
        include: { slots: true },
      });
      const allSlots = approvedMemberships.flatMap((m) => m.slots);
      const halfThreshold = Math.ceil(allSlots.length / 2);
      const paidContributionsCount = await prisma.contribution.count({
        where: {
          membershipSlotId: { in: allSlots.map((s) => s.id) },
          dueDate,
          status: "PAID",
        },
      });
      if (paidContributionsCount < halfThreshold) continue;

      const log = await prisma.foodTurnLog
        .create({ data: { membershipSlotId: designatedSlot.id, dueDate } })
        .catch(() => null); // unique violation = already notified for this cycle
      if (!log) continue;

      const membership = await prisma.membership.findUnique({
        where: { id: designatedSlot.membershipId },
        include: { user: true },
      });
      if (!membership) continue;

      const lang = membership.user.preferredLang === "en" ? "en" : "fr";
      const rawName = membership.user.name.trim();
      const firstName = rawName.split(/\s+/)[0] || rawName;
      const message = translate(lang, "foodTurnMessage", { name: firstName });

      if (membership.user.email) {
        const emailTitle =
          lang === "fr" ? "C'est votre tour de recevoir la cagnotte ! 🍲🎉" : "It's your turn to receive the pot! 🍲🎉";
        const emailHtml = renderBrandedEmailHtml({
          title: emailTitle,
          bodyText: message,
          actionUrl: `/sessions/${tontineSession.id}`,
          actionLabel: lang === "fr" ? "Fournir mes coordonnées" : "Submit Payout Details",
          lang,
          recipientName: membership.user.name,
        });
        await sendEmailSafe(
          membership.user.email,
          `DIVA Asso — ${emailTitle}`,
          emailHtml,
        );
      }
      await scheduleInAppNotifications({
        tontineSessionId: tontineSession.id,
        type: "FOOD_TURN",
        recipients: [
          {
            userId: membership.userId,
            message,
            messageKey: "foodTurnMessage",
            messageVars: { name: membership.user.name },
            actionUrl: `/sessions/${tontineSession.id}`,
          },
        ],
      });

      notified++;
    }
  }

  return NextResponse.json({ ok: true, notified });
}
