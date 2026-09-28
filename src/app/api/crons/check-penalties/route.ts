import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { TontineType } from "@/generated/prisma/enums";
import { computeFine, getCutoffInstant, isContributionDay, toDueDateKey, ALL_TONTINE_TYPES } from "@/lib/tontine-engine";
import { sendWhatsAppMessageSafe } from "@/lib/whatsapp/evolution";
import { sendEmailSafe } from "@/lib/email/resend";
import { fineNoticeMessage } from "@/lib/whatsapp/templates";
import { translate } from "@/lib/i18n/translations";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const summary: Array<{ sessionId: string; type: TontineType; finesIssued: number }> = [];

  for (const type of ALL_TONTINE_TYPES) {
    if (!isContributionDay(type, now)) continue;

    const cutoff = getCutoffInstant(now);
    if (now < cutoff) continue; // safety guard in case the cron fires before 18:31

    const dueDate = toDueDateKey(now);

    const sessions = await prisma.tontineSession.findMany({
      where: { type, status: "ACTIVE" },
      include: {
        memberships: {
          where: { status: "APPROVED" },
          include: {
            user: { select: { id: true, name: true, phone: true, email: true, preferredLang: true } },
            slots: true,
          },
        },
      },
    });

    for (const tontineSession of sessions) {
      const fineAmount = computeFine(type, now, cutoff, {
        fineAmountPerPeriod: tontineSession.fineAmountPerPeriod ? Number(tontineSession.fineAmountPerPeriod) : null,
        fineIntervalHours: tontineSession.fineIntervalHours,
      });
      if (fineAmount <= 0) continue;
      let finesIssued = 0;

      for (const membership of tontineSession.memberships) {
        for (const slot of membership.slots) {
          const key = { membershipSlotId_dueDate: { membershipSlotId: slot.id, dueDate } };

          const [contribution, existingFine] = await Promise.all([
            prisma.contribution.findUnique({ where: key }),
            prisma.fine.findUnique({ where: key }),
          ]);

          if (contribution?.status === "PAID") continue;
          // Never touch a fine that's already been settled (paid, or manually
          // deducted from a payout by an admin) — only recompute open ones.
          if (existingFine && existingFine.status !== "UNPAID") continue;

          const isNewFine = !existingFine;
          if (existingFine) {
            await prisma.fine.update({
              where: { id: existingFine.id },
              data: { amount: fineAmount },
            });
          } else {
            await prisma.fine.create({
              data: { membershipSlotId: slot.id, dueDate, amount: fineAmount, status: "UNPAID" },
            });
          }
          finesIssued++;

          // Notify once per cycle, the first time a member becomes late —
          // not on every subsequent daily re-run as the fine keeps growing.
          // NotificationLog is still one row per (user, session, cycle,
          // type), so a member with several newly-late slots in the same
          // run gets one combined notice, not one per slot.
          if (isNewFine && membership.user.phone) {
            const log = await prisma.notificationLog
              .create({
                data: { userId: membership.userId, tontineSessionId: tontineSession.id, dueDate, type: "FINE_NOTICE" },
              })
              .catch(() => null);
            if (log) {
              const lang = membership.user.preferredLang === "en" ? "en" : "fr";
              const message = fineNoticeMessage(
                lang,
                membership.user.name,
                type,
                fineAmount,
              );
              if (membership.user.phone) {
                await sendWhatsAppMessageSafe(membership.user.phone, message);
              }
              if (membership.user.email) {
                const subject = `${translate(lang, "notifTypeFineReminder")} — ${tontineSession.title || type}`;
                const emailHtml = `
                  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0;">
                    <div style="text-align: center; margin-bottom: 20px;">
                      <h2 style="color: #003528; margin: 0;">DIVA Association</h2>
                    </div>
                    <h3 style="color: #dc2626; margin-top: 0;">${subject}</h3>
                    <p style="font-size: 15px; line-height: 1.6; white-space: pre-line;">${message}</p>
                    <p style="margin-top: 24px;">
                      <a href="${process.env.NEXTAUTH_URL ?? "https://diva-association.vercel.app"}/fines" style="background-color: #003528; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Régulariser l'amende</a>
                    </p>
                  </div>
                `;
                await sendEmailSafe(membership.user.email, subject, emailHtml);
              }
            }
          }
        }
      }

      summary.push({ sessionId: tontineSession.id, type, finesIssued });
    }
  }

  return NextResponse.json({ ok: true, checkedAt: now.toISOString(), summary });
}
