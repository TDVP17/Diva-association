import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePresident } from "@/lib/require-admin";

const TONTINE_LABELS: Record<string, string> = {
  HEBDO_SUNDAY: "Weekly Tontine",
  MONTHLY_28: "Monthly Tontine (28th)",
  MONTHLY_25: "Monthly Tontine (25th)",
};

export async function GET() {
  const president = await requirePresident();
  if (!president) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sessions = await prisma.tontineSession.findMany({
    select: {
      id: true,
      title: true,
      type: true,
      memberships: {
        select: {
          slots: {
            select: {
              contributions: { where: { status: "PAID" }, select: { feePaid: true } },
              fines: { where: { status: { in: ["PAID", "DEDUCTED"] } }, select: { amount: true } },
            },
          },
        },
      },
    },
    orderBy: { startDate: "desc" },
  });

  const perSession = sessions.map((s) => {
    const slots = s.memberships.flatMap((m) => m.slots);
    const fees = slots.reduce(
      (sum, slot) => sum + slot.contributions.reduce((a, c) => a + Number(c.feePaid), 0),
      0,
    );
    const fines = slots.reduce((sum, slot) => sum + slot.fines.reduce((a, f) => a + Number(f.amount), 0), 0);
    return {
      id: s.id,
      title: s.title || TONTINE_LABELS[s.type] || s.type,
      fees,
      fines,
      total: fees + fines,
    };
  });

  const totalFees = perSession.reduce((sum, s) => sum + s.fees, 0);
  const totalFines = perSession.reduce((sum, s) => sum + s.fines, 0);

  return NextResponse.json({
    totalFees,
    totalFines,
    totalRevenue: totalFees + totalFines,
    sessions: perSession,
  });
}
