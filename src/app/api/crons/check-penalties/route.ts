import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { TontineType } from "@/generated/prisma/enums";
import { computeFine, getCutoffInstant, isContributionDay, toDueDateKey, ALL_TONTINE_TYPES } from "@/lib/tontine-engine";
import { sendEmailSafe } from "@/lib/email/resend";
import { renderBrandedEmailHtml } from "@/lib/email/template";
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
          if (isNewFine && (membership.user.email || membership.user.phone)) {
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
              if (membership.user.email) {
                const subject = `${translate(lang, "notifTypeFineReminder")} — ${tontineSession.title || type}`;
                const emailHtml = renderBrandedEmailHtml({
                  title: subject,
                  bodyText: message,
                  actionUrl: "/fines",
                  actionLabel: "Régulariser l'amende",
                  lang,
                });
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
