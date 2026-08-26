import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { getContributionTotal, getNextDueDate } from "@/lib/tontine-engine";

const TONTINE_LABELS: Record<string, string> = {
  HEBDO_SUNDAY: "Weekly Tontine",
  MONTHLY_28: "Monthly Tontine (28th)",
  MONTHLY_25: "Monthly Tontine (25th)",
};

// Per-contribution summary cards for the admin dashboard list — reuses the
// same aggregation shape as the existing single-session ledger route, just
// computed for every TontineSession at once.
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sessions = await prisma.tontineSession.findMany({
    include: {
      memberships: {
        where: { status: "APPROVED" },
        include: { slots: true },
      },
    },
    orderBy: { startDate: "desc" },
  });

  const now = new Date();
  const cards = await Promise.all(
    sessions.map(async (s) => {
      const slots = s.memberships.flatMap((m) => m.slots);
      const slotIds = slots.map((sl) => sl.id);
      const dueDate = getNextDueDate(s.type, now);
      const { total: perSlotTotal } = getContributionTotal({ amount: Number(s.amount), fee: Number(s.fee) });

      const [paidCount, feesAgg, unpaidFinesAgg, paidFinesAgg, notifCounts] = await Promise.all([
        slotIds.length
          ? prisma.contribution.count({ where: { membershipSlotId: { in: slotIds }, dueDate, status: "PAID" } })
          : 0,
        slotIds.length
          ? prisma.contribution.aggregate({
              where: { membershipSlotId: { in: slotIds }, status: "PAID" },
              _sum: { feePaid: true, amountPaid: true, finePaid: true },
            })
          : null,
        slotIds.length
          ? prisma.fine.aggregate({
              where: { membershipSlotId: { in: slotIds }, status: "UNPAID" },
              _sum: { amount: true },
            })
          : null,
        slotIds.length
          ? prisma.fine.aggregate({
              where: { membershipSlotId: { in: slotIds }, status: { in: ["PAID", "DEDUCTED"] } },
              _sum: { amount: true },
            })
          : null,
        prisma.notification.groupBy({
          by: ["status"],
          where: { tontineSessionId: s.id },
          _count: { _all: true },
        }),
      ]);

      const totalReceived =
        Number(feesAgg?._sum.amountPaid ?? 0) + Number(feesAgg?._sum.feePaid ?? 0) + Number(feesAgg?._sum.finePaid ?? 0);
      const expected = slots.length * perSlotTotal;
      const countByStatus = (status: string) =>
        notifCounts.find((n) => n.status === status)?._count._all ?? 0;

      return {
        id: s.id,
        title: s.title || TONTINE_LABELS[s.type] || s.type,
        type: s.type,
        status: s.status,
        totalMembers: slots.length,
        paidMembers: paidCount,
        unpaidMembers: slots.length - paidCount,
        expectedAmount: expected,
        receivedAmount: totalReceived,
        outstandingAmount: Math.max(0, expected - totalReceived),
        finesPaid: Number(paidFinesAgg?._sum.amount ?? 0),
        finesOutstanding: Number(unpaidFinesAgg?._sum.amount ?? 0),
        notificationsSent: countByStatus("SENT"),
        notificationsPending: countByStatus("PENDING") + countByStatus("SCHEDULED") + countByStatus("PROCESSING"),
        notificationsFailed: countByStatus("FAILED"),
      };
    }),
  );

  return NextResponse.json({ contributions: cards });
}
