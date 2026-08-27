import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { findYearsNeedingArchive, generateArchivePdf } from "@/lib/transaction-archive";
import { saveFile } from "@/lib/storage";

const TONTINE_LABELS: Record<string, string> = {
  HEBDO_SUNDAY: "Weekly Tontine (Sunday)",
  MONTHLY_28: "Monthly Tontine (28th)",
  MONTHLY_25: "Monthly Tontine (25th)",
};

/**
 * Daily cron — for every member, checks whether any fully-elapsed calendar
 * year has unarchived Contribution/Fine history and, if so, generates one
 * PDF snapshot per year and records it in TransactionArchive. Idempotent
 * per (userId, year) via the model's unique constraint, so re-running this
 * daily is a cheap no-op once a member is caught up. Never touches the
 * underlying Contribution/Fine rows — this only ever adds a snapshot.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const users = await prisma.user.findMany({
    where: { memberships: { some: {} } },
    select: { id: true, name: true },
  });

  let archived = 0;
  let skipped = 0;
  let failed = 0;

  for (const user of users) {
    const years = await findYearsNeedingArchive(user.id);
    for (const year of years) {
      const periodStart = new Date(Date.UTC(year, 0, 1));
      const periodEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

      try {
        const slots = await prisma.membershipSlot.findMany({
          where: { membership: { userId: user.id } },
          include: {
            contributions: { where: { dueDate: { gte: periodStart, lte: periodEnd } } },
            fines: { where: { dueDate: { gte: periodStart, lte: periodEnd } } },
            membership: { include: { tontineSession: { select: { title: true, type: true } } } },
          },
        });

        const rows = slots.flatMap((slot) => {
          const sessionLabel =
            slot.membership.tontineSession.title || TONTINE_LABELS[slot.membership.tontineSession.type] || "Cotisation";
          return [
            ...slot.contributions.map((c) => ({
              date: c.dueDate,
              label: `${sessionLabel} — ${slot.beneficiaryName}`,
              amount: Number(c.amountPaid) + Number(c.feePaid) + Number(c.finePaid),
              status: c.status,
            })),
            ...slot.fines.map((f) => ({
              date: f.dueDate,
              label: `Fine — ${sessionLabel} — ${slot.beneficiaryName}`,
              amount: Number(f.amount),
              status: f.status,
            })),
          ];
        });
        rows.sort((a, b) => a.date.getTime() - b.date.getTime());

        const pdfBytes = await generateArchivePdf(user.name, year, rows);
        const key = `archives/${user.id}/${year}.pdf`;
        await saveFile(key, pdfBytes);

        await prisma.transactionArchive.create({
          data: { userId: user.id, periodStart, periodEnd, pdfUrl: key },
        });
        archived++;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          // Already archived by a concurrent/earlier run this same day — fine.
          skipped++;
          continue;
        }
        console.error(`[archive-transactions] failed for user ${user.id}, year ${year}:`, err);
        failed++;
      }
    }
  }

  return NextResponse.json({ ok: true, archived, skipped, failed });
}
