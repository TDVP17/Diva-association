import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { runLoanPenaltySweep } from "@/lib/loans";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const loans = await prisma.loan.findMany({
    include: {
      user: { select: { id: true, name: true, email: true, phone: true, stars: true, memberCode: true } },
      guaranteeSlot: {
        select: {
          beneficiaryName: true,
          membership: {
            select: { tontineSession: { select: { title: true, type: true } } },
          },
        },
      },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
  });

  const stats = {
    pendingAdminCount: loans.filter((l) => l.status === "PENDING_ADMIN").length,
    activeCount: loans.filter((l) => l.status === "ACTIVE").length,
    overdueCount: loans.filter((l) => l.status === "OVERDUE").length,
    repaidCount: loans.filter((l) => l.status === "REPAID" || l.status === "DEDUCTED_FROM_POT").length,
    totalPrincipalLent: loans
      .filter((l) => l.status !== "PENDING_ADMIN" && l.status !== "REJECTED")
      .reduce((s, l) => s + Number(l.principal), 0),
    totalOutstanding: loans
      .filter((l) => l.status === "ACTIVE" || l.status === "OVERDUE")
      .reduce((s, l) => s + Math.max(0, Number(l.totalDue) - Number(l.totalPaid)), 0),
    totalInterestAndPenaltiesEarned: loans
      .filter((l) => l.status === "REPAID" || l.status === "DEDUCTED_FROM_POT")
      .reduce((s, l) => s + Number(l.interestAmount) + Number(l.penaltyAmount), 0),
  };

  return NextResponse.json({
    stats,
    loans: loans.map((l) => ({
      id: l.id,
      principal: Number(l.principal),
      interestAmount: Number(l.interestAmount),
      penaltyAmount: Number(l.penaltyAmount),
      totalDue: Number(l.totalDue),
      totalPaid: Number(l.totalPaid),
      remainingDue: Math.max(0, Number(l.totalDue) - Number(l.totalPaid)),
      status: l.status,
      requiresAdminApproval: l.requiresAdminApproval,
      rejectionReason: l.rejectionReason,
      dueDate: l.dueDate.toISOString(),
      graceEndDate: l.graceEndDate.toISOString(),
      repaidAt: l.repaidAt?.toISOString() ?? null,
      createdAt: l.createdAt.toISOString(),
      user: l.user,
      guaranteeSlotLabel: l.guaranteeSlot
        ? `${l.guaranteeSlot.membership.tontineSession.title || l.guaranteeSlot.membership.tontineSession.type} — ${l.guaranteeSlot.beneficiaryName}`
        : null,
    })),
  });
}

export async function POST() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const summary = await runLoanPenaltySweep();
  return NextResponse.json({ ok: true, ...summary });
}
