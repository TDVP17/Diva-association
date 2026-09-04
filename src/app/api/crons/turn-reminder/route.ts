import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { toDueDateKey, getCycleDateForRound } from "@/lib/tontine-engine";
import { getDesignatedSlot } from "@/lib/round-robin-lock";
import { translate } from "@/lib/i18n/translations";
import { scheduleNotifications, scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import { turnReminderTomorrowMessage } from "@/lib/whatsapp/templates";
import { TONTINE_TYPE_LABELS } from "@/lib/tontine-labels";
import { formatXAF } from "@/lib/format-currency";

/**
 * Runs once daily (see vercel.json). For every ACTIVE session with a
 * published ranking, checks whether the currently-designated beneficiary's
 * ESTIMATED payout date (getCycleDateForRound — the same canonical date
 * used everywhere else, e.g. the payout-order modal) falls tomorrow, and if
 * so sends a heads-up across every channel: Email + WhatsApp (queued via
 * scheduleNotifications, so delivery is retried and its real status is
 * recorded — never assumed) and In-App + Push (scheduleInAppNotifications).
 *
 * Gating is implicit rather than a separate check: only ACTIVE sessions are
 * queried, and getDesignatedSlot only ever returns a slot once officialPosition
 * has been published — so a DRAFT/DRAWING session, or one where the draw
 * hasn't been published yet, can never produce a reminder here.
 *
 * Idempotent via TurnReminderLog, same unique-constraint-catch pattern as
 * FoodTurnLog — kept as its own table (not sharing FoodTurnLog's key) so a
 * reminder sent a day early can never be mistaken by the food-turn cron for
 * "already notified today".
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tomorrowKey = toDueDateKey(new Date(Date.now() + 24 * 60 * 60 * 1000));
  let notified = 0;

  const activeSessions = await prisma.tontineSession.findMany({ where: { status: "ACTIVE" } });

  for (const tontineSession of activeSessions) {
    const designatedSlot = await getDesignatedSlot(tontineSession.id);
    if (!designatedSlot || designatedSlot.officialPosition === null) continue;

    const estimatedDate = getCycleDateForRound(
      tontineSession.type,
      tontineSession.startDate,
      designatedSlot.officialPosition,
    );
    if (estimatedDate.getTime() !== tomorrowKey.getTime()) continue;

    const log = await prisma.turnReminderLog
      .create({ data: { membershipSlotId: designatedSlot.id, estimatedDate } })
      .catch(() => null); // unique violation = already sent for this slot+date
    if (!log) continue;

    const membership = await prisma.membership.findUnique({
      where: { id: designatedSlot.membershipId },
      include: { user: true },
    });
    if (!membership) continue;

    const approvedMemberships = await prisma.membership.findMany({
      where: { tontineSessionId: tontineSession.id, status: "APPROVED" },
      select: { slotCount: true },
    });
    const totalApprovedSlots = approvedMemberships.reduce(
      (sum, m) => sum + (m.slotCount ? Number(m.slotCount) : 0),
      0,
    );
    const estimatedAmount = Number(tontineSession.amount) * totalApprovedSlots;

    const lang = membership.user.preferredLang === "fr" ? "fr" : "en";
    const sessionLabel = tontineSession.title || TONTINE_TYPE_LABELS[tontineSession.type];
    const firstName = membership.user.name.trim().split(/\s+/)[0] ?? membership.user.name;
    const dateLabel = estimatedDate.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-GB", {
      timeZone: "Africa/Douala",
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    const messageVars = {
      name: firstName,
      cotisation: sessionLabel,
      position: String(designatedSlot.officialPosition),
      amount: formatXAF(estimatedAmount),
      date: dateLabel,
    };

    await scheduleNotifications({
      tontineSessionId: tontineSession.id,
      channel: "EMAIL",
      type: "TURN_REMINDER_TOMORROW",
      recipients: [
        {
          userId: membership.userId,
          message: translate(lang, "waTurnReminderTomorrow", messageVars),
        },
      ],
    });

    if (membership.user.phone) {
      await scheduleNotifications({
        tontineSessionId: tontineSession.id,
        channel: "WHATSAPP",
        type: "TURN_REMINDER_TOMORROW",
        recipients: [
          {
            userId: membership.userId,
            message: turnReminderTomorrowMessage(
              lang,
              firstName,
              sessionLabel,
              designatedSlot.officialPosition,
              estimatedAmount,
              dateLabel,
            ),
          },
        ],
      });
    }

    await scheduleInAppNotifications({
      tontineSessionId: tontineSession.id,
      type: "TURN_REMINDER_TOMORROW",
      recipients: [
        {
          userId: membership.userId,
          message: translate(lang, "turnReminderTomorrowNotifMessage", messageVars),
          messageKey: "turnReminderTomorrowNotifMessage",
          messageVars,
          actionUrl: `/sessions/${tontineSession.id}`,
        },
      ],
    });

    notified++;
  }

  return NextResponse.json({ ok: true, notified });
}
