import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getLang } from "@/lib/i18n/get-lang";
import { getUserWalletData } from "@/lib/wallet";
import { getWithdrawalLockStatus } from "@/lib/wallet-pin";
import { getEffectiveWithdrawalLimits } from "@/lib/withdrawal-limits";
import { getFallbackPaymentConfig } from "@/lib/fallback-payment-config";
import { syncLoanPenaltiesForUser } from "@/lib/loans";
import { WalletClient } from "./wallet-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function WalletPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  const userId = session.user.id;
  const lang = await getLang();

  await syncLoanPenaltiesForUser(userId).catch(() => {});

  const [
    walletData,
    securityUser,
    savedMethods,
    recentWithdrawals,
    withdrawalLimits,
    operatorConfig,
    activeLoanRow,
  ] = await Promise.all([
    getUserWalletData(userId),
    prisma.user.findUnique({
      where: { id: userId },
      select: { walletPinHash: true, phoneChangedAt: true, stars: true },
    }),
    prisma.savedPaymentMethod.findMany({
      where: { userId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    }),
    prisma.walletWithdrawal.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    getEffectiveWithdrawalLimits(userId),
    getFallbackPaymentConfig(),
    prisma.loan.findFirst({
      where: { userId, status: { in: ["ACTIVE", "OVERDUE"] } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        totalDue: true,
        totalPaid: true,
        dueDate: true,
        status: true,
      },
    }),
  ]);

  // Prioritize MTN first as requested by user
  const sortedMethods = [...savedMethods].sort((a, b) => {
    if (a.provider === "MTN" && b.provider !== "MTN") return -1;
    if (a.provider !== "MTN" && b.provider === "MTN") return 1;
    return 0;
  });

  const lockStatus = getWithdrawalLockStatus(securityUser?.phoneChangedAt);

  return (
    <main className="px-container-padding pt-stack-gap-md pb-24 max-w-xl mx-auto w-full">
      <WalletClient
        lang={lang}
        initialBalance={walletData.user.walletBalance}
        initialTotalContributed={walletData.totalContributed}
        initialFeePercentage={walletData.feeInfo.percentage}
        isPrivateMember={walletData.feeInfo.isPrivateMember}
        userPhone={walletData.user.phone}
        userName={walletData.user.name}
        userStars={securityUser?.stars ?? 0}
        operations={walletData.operations}
        olderOperationsCount={walletData.olderOperationsCount}
        initialHasPin={Boolean(securityUser?.walletPinHash)}
        withdrawalLockRemainingHours={lockStatus.remainingHours}
        withdrawalLimits={{
          minAmount: withdrawalLimits.minAmount,
          maxAmount: withdrawalLimits.maxAmount,
        }}
        operatorSuspension={{
          isOrangeSuspended: Boolean(operatorConfig.isOrangeSuspended),
          orangeSuspendedReason: operatorConfig.orangeSuspendedReason ?? "",
          isMtnSuspended: Boolean(operatorConfig.isMtnSuspended),
          mtnSuspendedReason: operatorConfig.mtnSuspendedReason ?? "",
          orangeCashInEnabled: operatorConfig.orangeCashInEnabled ?? true,
          orangeCashOutEnabled: operatorConfig.orangeCashOutEnabled ?? true,
          orangeCashInDisabledReason: operatorConfig.orangeCashInDisabledReason ?? "",
          orangeCashOutDisabledReason: operatorConfig.orangeCashOutDisabledReason ?? "",
          mtnCashInEnabled: operatorConfig.mtnCashInEnabled ?? true,
          mtnCashOutEnabled: operatorConfig.mtnCashOutEnabled ?? true,
          mtnCashInDisabledReason: operatorConfig.mtnCashInDisabledReason ?? "",
          mtnCashOutDisabledReason: operatorConfig.mtnCashOutDisabledReason ?? "",
        }}
        activeLoan={
          activeLoanRow
            ? {
                id: activeLoanRow.id,
                remainingDue: Math.max(
                  0,
                  Number(activeLoanRow.totalDue) - Number(activeLoanRow.totalPaid || 0),
                ),
                dueDate: activeLoanRow.dueDate.toISOString(),
                status: activeLoanRow.status,
              }
            : null
        }
        disbursementMethods={sortedMethods.map((m) => ({
          id: m.id,
          provider: m.provider,
          phone: m.phone,
          accountName: m.accountName || walletData.user.name,
          status: m.status,
        }))}
        initialWithdrawals={recentWithdrawals.map((w) => ({
          id: w.id,
          amount: Number(w.amount),
          phone: w.phone,
          provider: w.provider,
          status: w.status,
          requiresAdminApproval: w.requiresAdminApproval,
          rejectionReason: w.rejectionReason,
          createdAt: w.createdAt.toISOString(),
        }))}
      />
    </main>
  );
}
