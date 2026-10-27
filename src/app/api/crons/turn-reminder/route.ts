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
            include: { user: true, slots: true },
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
            const mySlotsList = membership.slots.map((s) => s.beneficiaryName).join(", ");

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

              <div style="background-color: #fefce8; border: 1px solid #fef08a; border-radius: 10px; padding: 14px; margin: 16px 0; text-align: left; font-size: 13px; color: #854d0e;">
                <p style="margin: 0 0 6px 0; font-weight: 700; color: #713f12; font-size: 14px;">
                  ⚠️ ${lang === "fr" ? "Obligation de cotiser pour vos parts :" : "Mandatory contribution for your parts:"}
                </p>
                <p style="margin: 0; line-height: 1.5;">
                  ${
                    lang === "fr"
                      ? `Même si c'est votre tour de recevoir la cagnotte demain, vous avez <strong>l'obligation stricte de cotiser pour vos noms (${mySlotsList})</strong>. C'est uniquement lorsque 100% des membres (y compris vous-même) auront cotisé que vous recevrez l'alerte pour renseigner vos coordonnées Orange/MTN Money afin d'encaisser votre virement !`
                      : `Even though it's your turn to receive the pot tomorrow, you have the <strong>strict obligation to contribute for your names (${mySlotsList})</strong>. Only once 100% of members (including yourself) have contributed will you be prompted to submit your Orange/MTN Money details to cash out!`
                  }
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
                      ? `Demain c'est votre tour de recevoir la cagnotte de ${sessionLabel} (${formatXAF(estimatedAmount)}) ! N'oubliez pas : vous devez obligatoirement cotiser pour vos noms (${mySlotsList}). C'est quand tout le monde a cotisé que vos coordonnées de paiement vous seront demandées.`
                      : `Tomorrow is your turn to receive the ${sessionLabel} pot (${formatXAF(estimatedAmount)})! Remember: you must contribute for your names (${mySlotsList}). Payout details will be requested once all members have contributed.`,
                  actionUrl: `/sessions/${tontineSession.id}`,
                },
              ],
            });

            turnNotified++;
          }
        }
      }

      // --- 1b. Payout Turn Reminder (TODAY - morning before 9h00) ---
      if (estimatedDate.getTime() === todayKey.getTime()) {
        const logToday = await prisma.turnReminderLog
          .create({ data: { membershipSlotId: designatedSlot.id, estimatedDate: todayKey } })
          .catch(() => null);

        if (logToday) {
          const membership = await prisma.membership.findUnique({
            where: { id: designatedSlot.membershipId },
            include: { user: true, slots: true },
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

            // Check if member has OTHER registered slots in this session
            const otherSlots = membership.slots.filter((s) => s.id !== designatedSlot.id);
            const hasOtherSlots = otherSlots.length > 0;
            const otherSlotNames = otherSlots.map((s) => s.beneficiaryName).join(", ");

            const warningOtherSlotsFr = hasOtherSlots
              ? `<div style="background-color: #fffbeb; border: 1px solid #fef3c7; border-radius: 8px; padding: 12px; margin-top: 14px; color: #92400e; font-size: 13px;">
                  ⚠️ <strong>Attention :</strong> Vous avez d'autres noms enregistrés dans cette cotisation (<strong>${otherSlotNames}</strong>). Vous devez obligatoirement cotiser pour ces autres noms, sinon des amendes de retard s'appliqueront à ces noms !
                 </div>`
              : "";

            const warningOtherSlotsEn = hasOtherSlots
              ? `<div style="background-color: #fffbeb; border: 1px solid #fef3c7; border-radius: 8px; padding: 12px; margin-top: 14px; color: #92400e; font-size: 13px;">
                  ⚠️ <strong>Warning:</strong> You have other registered names in this cotisation (<strong>${otherSlotNames}</strong>). You must contribute for these other names, otherwise late fines will apply to them!
                 </div>`
              : "";

            const emailTitle =
              lang === "fr"
                ? `C'est votre tour de bouffer aujourd'hui ! 🍲🎉 — ${sessionLabel}`
                : `It's your turn to receive the pot today! 🍲🎉 — ${sessionLabel}`;

            const emailBodyHtml = `
              <p style="margin-top: 0;">${lang === "fr" ? `Salut <strong>${firstName}</strong> 👋,` : `Hello <strong>${firstName}</strong> 👋,`}</p>
              <p>
                ${
                  lang === "fr"
                    ? `Aujourd'hui, c'est votre tour de bouffer la cagnotte pour votre nom <strong>${designatedSlot.beneficiaryName}</strong> dans la cotisation <strong>${sessionLabel}</strong> ! 🎉`
                    : `Today is your turn to receive the pot for your name <strong>${designatedSlot.beneficiaryName}</strong> in the <strong>${sessionLabel}</strong> cotisation! 🎉`
                }
              </p>
              <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 18px; margin: 20px 0; text-align: center;">
                <p style="margin: 0 0 6px 0; font-size: 13px; color: #166534; font-weight: 600; text-transform: uppercase;">
                  ${lang === "fr" ? "Montant de la cagnotte estimé" : "Estimated Pot Amount"}
                </p>
                <div style="font-size: 28px; font-weight: 800; color: #003528;">
                  ${formatXAF(estimatedAmount)}
                </div>
                <p style="margin: 8px 0 0 0; font-size: 12px; color: #15803d;">
                  ${lang === "fr" ? `Position officielle : N°${designatedSlot.officialPosition}` : `Official Position: #${designatedSlot.officialPosition}`}
                </p>
              </div>
              <p style="font-size: 14px; color: #334155;">
                ${
                  lang === "fr"
                    ? `💡 <strong>Important :</strong> Tout le monde doit obligatoirement cotiser pour ce cycle, y compris pour votre part (<strong>${designatedSlot.beneficiaryName}</strong>). Dès que tous les membres auront cotisé, vous recevrez une alerte pour renseigner vos coordonnées Orange/MTN Money afin de recevoir la cagnotte !`
                    : `💡 <strong>Important:</strong> Everyone must contribute for this cycle, including for your part (<strong>${designatedSlot.beneficiaryName}</strong>). Once all members have contributed, you will be prompted to provide your Orange/MTN Money details to receive the pot!`
                }
              </p>
              ${lang === "fr" ? warningOtherSlotsFr : warningOtherSlotsEn}
            `;

            if (membership.user.email) {
              const emailHtml = renderBrandedEmailHtml({
                title: emailTitle,
                bodyHtml: emailBodyHtml,
                actionUrl: `/sessions/${tontineSession.id}`,
                actionLabel: lang === "fr" ? "Consulter ma cotisation" : "View Cotisation",
                lang,
                recipientName: membership.user.name,
              });
              await sendEmailSafe(membership.user.email, emailTitle, emailHtml);
            }

            const inAppMsg =
              lang === "fr"
                ? `Salut, ${firstName} 👋 ! Aujourd'hui c'est votre tour de bouffer la cagnotte (${formatXAF(estimatedAmount)}) pour « ${designatedSlot.beneficiaryName} » dans ${sessionLabel} ! N'oubliez pas de cotiser pour vos parts. Dès que tous les membres auront cotisé, vous serez invité à fournir vos coordonnées de paiement.`
                : `Hello, ${firstName} 👋! Today is your turn to receive the pot (${formatXAF(estimatedAmount)}) for "${designatedSlot.beneficiaryName}" in ${sessionLabel}! Remember to contribute for your parts. Once all members have contributed, you will be prompted to submit your payout details.`;

            await scheduleInAppNotifications({
              tontineSessionId: tontineSession.id,
              type: "FOOD_TURN",
              recipients: [
                {
                  userId: membership.userId,
                  message: inAppMsg,
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

  return NextResponse.json({ ok: true, notified: turnNotified, turnNotified, reminderNotified });
}
