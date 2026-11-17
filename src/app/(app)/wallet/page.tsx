import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getLang } from "@/lib/i18n/get-lang";
import { getUserWalletData } from "@/lib/wallet";
import { getWithdrawalLockStatus } from "@/lib/wallet-pin";
import { WalletClient } from "./wallet-client";

export default async function WalletPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  const userId = session.user.id;
  const lang = await getLang();

  const [walletData, securityUser, savedMethods, recentWithdrawals] = await Promise.all([
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
