import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { TontineType } from "@/generated/prisma/enums";
import { computeFine, getCutoffInstant, getCycleDateForRound } from "@/lib/tontine-engine";
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

  const sessions = await prisma.tontineSession.findMany({
    where: { status: "ACTIVE" },
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
    const totalSlots = tontineSession.memberships.reduce((sum, m) => sum + m.slots.length, 0) || 1;
    let finesIssued = 0;

    // Check all past due dates up to today for this active session
    for (let round = 1; round <= totalSlots; round++) {
      const roundDueDate = getCycleDateForRound(tontineSession.type, tontineSession.startDate, round);
      if (roundDueDate > now) break; // Future round, stop

      const cutoff = getCutoffInstant(roundDueDate);
      if (now < cutoff) continue; // Not past cutoff yet

      const fineAmount = computeFine(tontineSession.type, now, cutoff, {
        fineAmountPerPeriod: tontineSession.fineAmountPerPeriod ? Number(tontineSession.fineAmountPerPeriod) : null,
        fineIntervalHours: tontineSession.fineIntervalHours,
      });
      if (fineAmount <= 0) continue;

      for (const membership of tontineSession.memberships) {
        for (const slot of membership.slots) {
          const key = { membershipSlotId_dueDate: { membershipSlotId: slot.id, dueDate: roundDueDate } };

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
              data: { membershipSlotId: slot.id, dueDate: roundDueDate, amount: fineAmount, status: "UNPAID" },
            });
          }
          finesIssued++;

          // Notify once per cycle, the first time a member becomes late —
          // not on every subsequent daily re-run as the fine keeps growing.
          if (isNewFine && (membership.user.email || membership.user.phone)) {
            const log = await prisma.notificationLog
              .create({
                data: { userId: membership.userId, tontineSessionId: tontineSession.id, dueDate: roundDueDate, type: "FINE_NOTICE" },
              })
              .catch(() => null);
            if (log) {
              const lang = membership.user.preferredLang === "en" ? "en" : "fr";
              const message = fineNoticeMessage(
                lang,
                membership.user.name,
                tontineSession.type,
                fineAmount,
              );
              if (membership.user.email) {
                const subject = `${translate(lang, "notifTypeFineReminder")} — ${tontineSession.title || tontineSession.type}`;
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
    }

    if (finesIssued > 0) {
      summary.push({ sessionId: tontineSession.id, type: tontineSession.type, finesIssued });
    }
  }

  return NextResponse.json({ ok: true, checkedAt: now.toISOString(), summary });
}
