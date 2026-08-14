import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { TontineType } from "@/generated/prisma/enums";
import { computeFine, getCutoffInstant, isContributionDay, toDueDateKey } from "@/lib/tontine-engine";
import { sendWhatsAppMessageSafe } from "@/lib/whatsapp/evolution";
import { fineNoticeMessage } from "@/lib/whatsapp/templates";

const ALL_TONTINE_TYPES: TontineType[] = ["HEBDO_SUNDAY", "MONTHLY_25", "MONTHLY_28"];

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
    const fineAmount = computeFine(type, now, cutoff);
    if (fineAmount <= 0) continue;

    const sessions = await prisma.tontineSession.findMany({
      where: { type, status: "ACTIVE" },
      include: {
        memberships: { include: { user: { select: { id: true, name: true, phone: true } } } },
      },
    });

    for (const tontineSession of sessions) {
      let finesIssued = 0;

      for (const membership of tontineSession.memberships) {
        const key = {
          userId_tontineSessionId_dueDate: {
            userId: membership.userId,
            tontineSessionId: tontineSession.id,
            dueDate,
          },
        };

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
            data: {
              userId: membership.userId,
              tontineSessionId: tontineSession.id,
              dueDate,
              amount: fineAmount,
              status: "UNPAID",
            },
          });
        }
        finesIssued++;

        // Notify once per cycle, the first time a member becomes late —
        // not on every subsequent daily re-run as the fine keeps growing.
        if (isNewFine && membership.user.phone) {
          const log = await prisma.notificationLog
            .create({
              data: { userId: membership.userId, tontineSessionId: tontineSession.id, dueDate, type: "FINE_NOTICE" },
            })
            .catch(() => null);
          if (log) {
            await sendWhatsAppMessageSafe(
              membership.user.phone,
              fineNoticeMessage(membership.user.name, type, fineAmount),
            );
          }
        }
      }

      summary.push({ sessionId: tontineSession.id, type, finesIssued });
    }
  }

  return NextResponse.json({ ok: true, checkedAt: now.toISOString(), summary });
}
