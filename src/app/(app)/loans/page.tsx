import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getLang } from "@/lib/i18n/get-lang";
import { evaluateUserLoanEligibility, syncLoanPenaltiesForUser } from "@/lib/loans";
import { LoansClient, type LoanItem } from "./loans-client";

export default async function LoansPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const lang = await getLang();

  await syncLoanPenaltiesForUser(userId);

  const [eligibility, loans, user] = await Promise.all([
    evaluateUserLoanEligibility(userId),
    prisma.loan.findMany({
      where: { userId },
      include: {
        guaranteeSlot: {
          select: {
            beneficiaryName: true,
            membership: {
              select: { tontineSession: { select: { title: true, type: true } } },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { walletBalance: true },
    }),
  ]);

  const initialLoans: LoanItem[] = loans.map((l) => ({
    id: l.id,
    principal: Number(l.principal),
    interestRate: Number(l.interestRate),
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
    guaranteeSlotLabel: l.guaranteeSlot
      ? `${l.guaranteeSlot.membership.tontineSession.title || l.guaranteeSlot.membership.tontineSession.type} — ${l.guaranteeSlot.beneficiaryName}`
      : null,
  }));

  return (
    <LoansClient
      lang={lang}
      initialEligibility={eligibility}
      initialLoans={initialLoans}
      initialWalletBalance={Number(user?.walletBalance || 0)}
    />
  );
}
