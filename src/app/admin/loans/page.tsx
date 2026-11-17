import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { AdminLoansClient, type AdminLoanRow, type AdminLoanStats } from "./admin-loans-client";

export default async function AdminLoansPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/dashboard");

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

  const stats: AdminLoanStats = {
    activeCount: loans.filter((l) => l.status === "ACTIVE").length,
    overdueCount: loans.filter((l) => l.status === "OVERDUE").length,
    repaidCount: loans.filter((l) => l.status === "REPAID" || l.status === "DEDUCTED_FROM_POT").length,
    totalPrincipalLent: loans.reduce((s, l) => s + Number(l.principal), 0),
    totalOutstanding: loans
      .filter((l) => l.status === "ACTIVE" || l.status === "OVERDUE")
      .reduce((s, l) => s + Math.max(0, Number(l.totalDue) - Number(l.totalPaid)), 0),
    totalInterestAndPenaltiesEarned: loans
      .filter((l) => l.status === "REPAID" || l.status === "DEDUCTED_FROM_POT")
      .reduce((s, l) => s + Number(l.interestAmount) + Number(l.penaltyAmount), 0),
  };

  const initialLoans: AdminLoanRow[] = loans.map((l) => ({
    id: l.id,
    principal: Number(l.principal),
    interestAmount: Number(l.interestAmount),
    penaltyAmount: Number(l.penaltyAmount),
    totalDue: Number(l.totalDue),
    totalPaid: Number(l.totalPaid),
    remainingDue: Math.max(0, Number(l.totalDue) - Number(l.totalPaid)),
    status: l.status,
    dueDate: l.dueDate.toISOString(),
    graceEndDate: l.graceEndDate.toISOString(),
    repaidAt: l.repaidAt?.toISOString() ?? null,
    createdAt: l.createdAt.toISOString(),
    user: l.user,
    guaranteeSlotLabel: l.guaranteeSlot
      ? `${l.guaranteeSlot.membership.tontineSession.title || l.guaranteeSlot.membership.tontineSession.type} — ${l.guaranteeSlot.beneficiaryName}`
      : null,
  }));

  return <AdminLoansClient initialStats={stats} initialLoans={initialLoans} />;
}

