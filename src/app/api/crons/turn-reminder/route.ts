import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { toDueDateKey, getCycleDateForRound, getNextDueDate, getContributionTotal } from "@/lib/tontine-engine";
import { getDesignatedSlot } from "@/lib/round-robin-lock";
import { getUnpaidSlots } from "@/lib/notify";
import { translate } from "@/lib/i18n/translations";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import { renderBrandedEmailHtml } from "@/lib/email/template";
import { sendEmailSafe } from "@/lib/email/resend";
import { TONTINE_TYPE_LABELS } from "@/lib/tontine-labels";
import { formatXAF } from "@/lib/format-currency";

/**
 * Runs once daily at 7:00 AM UTC (8:00 AM Cameroon time).
 * 1. Payout turn reminder: Alerts the beneficiary whose payout turn is TOMORROW via Email and In-App.
 * 2. Advance contribution reminders (3, 2, and 1 days before): Reminds members who have NOT YET
 *    contributed for the upcoming cycle. Members who have already contributed are excluded.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const todayKey = toDueDateKey(now);
  const tomorrowKey = toDueDateKey(new Date(Date.now() + 24 * 60 * 60 * 1000));
  let turnNotified = 0;
  let reminderNotified = 0;

  const activeSessions = await prisma.tontineSession.findMany({ where: { status: "ACTIVE" } });

  for (const tontineSession of activeSessions) {
    const sessionLabel = tontineSession.title || TONTINE_TYPE_LABELS[tontineSession.type] || tontineSession.type;

    // --- 1. Payout Turn Reminder (Tomorrow) ---
    const designatedSlot = await getDesignatedSlot(tontineSession.id);
    if (designatedSlot && designatedSlot.officialPosition !== null && designatedSlot.ballDrawn !== null) {
      const estimatedDate = getCycleDateForRound(
        tontineSession.type,
        tontineSession.startDate,
        designatedSlot.officialPosition,
      );

      if (estimatedDate.getTime() === tomorrowKey.getTime()) {
        const log = await prisma.turnReminderLog
          .create({ data: { membershipSlotId: designatedSlot.id, estimatedDate } })
          .catch(() => null);

        if (log) {
          const membership = await prisma.membership.findUnique({
            where: { id: designatedSlot.membershipId },
            include: { user: true },
          });

          if (membership) {
            const approvedMemberships = await prisma.membership.findMany({
              where: { tontineSessionId: tontineSession.id, status: "APPROVED" },
              select: { slotCount: true },
            });
            const totalApprovedSlots = approvedMemberships.reduce(
              (sum, m) => sum + (m.slotCount ? Number(m.slotCount) : 0),
              0,
            );
            const estimatedAmount = Number(tontineSession.amount) * totalApprovedSlots;
            const lang = membership.user.preferredLang === "en" ? "en" : "fr";
            const firstName = membership.user.name.trim().split(/\s+/)[0] ?? membership.user.name;
            const dateLabel = estimatedDate.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-GB", {
              timeZone: "Africa/Douala",
              day: "numeric",
              month: "long",
              year: "numeric",
            });

            const emailTitle =
              lang === "fr"
                ? `Votre tour de bouffer approche ! (Demain) — ${sessionLabel}`
                : `Your payout turn is tomorrow! — ${sessionLabel}`;

            const emailBodyHtml = `
              <p style="margin-top: 0;">${lang === "fr" ? `Bonjour <strong>${firstName}</strong>,` : `Hello <strong>${firstName}</strong>,`}</p>
              <p>
                ${
                  lang === "fr"
                    ? `Préparez-vous ! Demain (<strong>${dateLabel}</strong>), c'est votre tour de bénéficier de la cagnotte pour la tontine <strong>${sessionLabel}</strong>.`
                    : `Get ready! Tomorrow (<strong>${dateLabel}</strong>), it's your turn to receive the pot for the <strong>${sessionLabel}</strong> cotisation.`
                }
              </p>
              <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 18px; margin: 20px 0; text-align: center;">
                <p style="margin: 0 0 6px 0; font-size: 13px; color: #166534; font-weight: 600; text-transform: uppercase;">
                  ${lang === "fr" ? "Montant estimé de la cagnotte" : "Estimated Pot Amount"}
                </p>
                <div style="font-size: 28px; font-weight: 800; color: #003528;">
                  ${formatXAF(estimatedAmount)}
                </div>
                <p style="margin: 8px 0 0 0; font-size: 12px; color: #15803d;">
                  ${lang === "fr" ? `Position officielle : N°${designatedSlot.officialPosition}` : `Official Position: #${designatedSlot.officialPosition}`}
                </p>
              </div>
              <p style="font-size: 14px; color: #64748b;">
                ${
                  lang === "fr"
                    ? "Vérifiez que votre numéro de réception Mobile Money ou Orange Money est bien à jour sur votre profil."
                    : "Please make sure your Mobile Money or Orange Money payout number is up to date in your profile."
                }
              </p>
            `;

            if (membership.user.email) {
              const emailHtml = renderBrandedEmailHtml({
                title: emailTitle,
                bodyHtml: emailBodyHtml,
                actionUrl: `/sessions/${tontineSession.id}`,
                actionLabel: lang === "fr" ? "Voir les détails de la tontine" : "View Tontine Details",
                lang,
              });
              await sendEmailSafe(membership.user.email, emailTitle, emailHtml);
            }

            await scheduleInAppNotifications({
              tontineSessionId: tontineSession.id,
              type: "TURN_REMINDER_TOMORROW",
              recipients: [
                {
                  userId: membership.userId,
                  message:
                    lang === "fr"
                      ? `Demain c'est votre tour de recevoir la cagnotte de ${sessionLabel} (${formatXAF(estimatedAmount)}) !`
                      : `Tomorrow is your turn to receive the ${sessionLabel} payout (${formatXAF(estimatedAmount)})!`,
                  actionUrl: `/sessions/${tontineSession.id}`,
                },
              ],
            });

            turnNotified++;
          }
        }
      }
    }

    // --- 2. Advance Contribution Reminders (J-3, J-2, J-1) for unpaid members only ---
    try {
      const nextDueDate = getNextDueDate(tontineSession.type, now);
      const diffDays = Math.round((nextDueDate.getTime() - todayKey.getTime()) / (24 * 60 * 60 * 1000));

      if (diffDays === 3 || diffDays === 2 || diffDays === 1) {
        const { amount } = getContributionTotal({
          amount: Number(tontineSession.amount),
          fee: Number(tontineSession.fee),
        });

        // getUnpaidSlots only returns slots that have NOT paid for nextDueDate.
        // Members who already paid are completely excluded!
        const unpaidSlots = await getUnpaidSlots(tontineSession.id, nextDueDate);
        const uniqueUnpaidUsers = new Map<string, (typeof unpaidSlots)[0]>();
        for (const slot of unpaidSlots) {
          if (!uniqueUnpaidUsers.has(slot.userId)) {
            uniqueUnpaidUsers.set(slot.userId, slot);
          }
        }

        for (const [userId, slot] of uniqueUnpaidUsers) {
          if (!slot.user.email) continue;

          // Check idempotency: send at most one reminder email per user/session/day
          const alreadyReminded = await prisma.notification.findFirst({
            where: {
              userId,
              tontineSessionId: tontineSession.id,
              channel: "EMAIL",
              type: "CONTRIBUTION_REMINDER",
              createdAt: { gte: todayKey },
            },
          });
          if (alreadyReminded) continue;

          const lang = slot.user.preferredLang === "en" ? "en" : "fr";
          const dateStr = nextDueDate.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-GB", {
            timeZone: "Africa/Douala",
            day: "numeric",
            month: "long",
            year: "numeric",
          });

          const title =
            diffDays === 1
              ? lang === "fr"
                ? `Rappel important : Cotisation demain — ${sessionLabel}`
                : `Important Reminder: Contribution Due Tomorrow — ${sessionLabel}`
              : lang === "fr"
                ? `Rappel : Cotisation dans ${diffDays} jours — ${sessionLabel}`
                : `Reminder: Contribution Due in ${diffDays} Days — ${sessionLabel}`;

          const bodyHtml = `
            <p style="margin-top: 0;">${lang === "fr" ? `Bonjour <strong>${slot.user.name}</strong>,` : `Hello <strong>${slot.user.name}</strong>,`}</p>
            <p>
              ${
                lang === "fr"
                  ? `Nous vous rappelons que votre cotisation pour la tontine <strong>${sessionLabel}</strong> arrive à échéance <strong>${diffDays === 1 ? "demain" : `dans ${diffDays} jours`}</strong> (${dateStr}).`
                  : `This is a reminder that your contribution for the <strong>${sessionLabel}</strong> tontine is due <strong>${diffDays === 1 ? "tomorrow" : `in ${diffDays} days`}</strong> (${dateStr}).`
              }
            </p>
            <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 18px; margin: 20px 0; text-align: center;">
              <p style="margin: 0 0 6px 0; font-size: 13px; color: #166534; font-weight: 600; text-transform: uppercase;">
                ${lang === "fr" ? "Montant à cotiser" : "Contribution Amount"}
              </p>
              <div style="font-size: 28px; font-weight: 800; color: #003528;">
                ${formatXAF(amount)}
              </div>
            </div>
            <p style="font-size: 14px; color: #64748b;">
              ${
                lang === "fr"
                  ? "Réglez votre cotisation en toute simplicité directement depuis votre téléphone par Mobile Money ou Orange Money."
                  : "Pay your contribution easily directly from your phone via Mobile Money or Orange Money."
              }
            </p>
          `;

          const emailHtml = renderBrandedEmailHtml({
            title,
            bodyHtml,
            actionUrl: `/sessions/${tontineSession.id}`,
            actionLabel: lang === "fr" ? `Cotiser maintenant (${formatXAF(amount)})` : `Pay Now (${formatXAF(amount)})`,
            lang,
          });

          await sendEmailSafe(slot.user.email, title, emailHtml);

          await prisma.notification.create({
            data: {
              userId,
              tontineSessionId: tontineSession.id,
              channel: "EMAIL",
              type: "CONTRIBUTION_REMINDER",
              message: title,
              status: "SENT",
              actionUrl: `/sessions/${tontineSession.id}`,
            },
          });

          reminderNotified++;
        }
      }
    } catch (reminderErr) {
      console.error(`[turn-reminder] advance reminder failed for session ${tontineSession.id}:`, reminderErr);
    }
  }

  return NextResponse.json({ ok: true, turnNotified, reminderNotified });
}
