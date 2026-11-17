import { prisma } from "@/lib/prisma";
import { formatXAF } from "@/lib/format-currency";

export interface WalletOperation {
  id: string;
  type:
    | "DEPOSIT"
    | "CONTRIBUTION"
    | "FINE"
    | "PAYOUT"
    | "WITHDRAWAL"
    | "REFUND"
    | "ADMIN_ADJUST"
    | "LOAN_DISBURSEMENT"
    | "LOAN_REPAYMENT";
  direction: "IN" | "OUT";
  title: string;
  subtitle: string;
  amount: number;
  formattedAmount: string;
  fee: number;
  date: string;
  timestamp: number;
  rawDate: Date;
  status: string;
}

/**
 * Calculates the recharge fee percentage for a member:
 * - If member has any APPROVED membership in a private cotisation: 5.1%
 * - If member has both public and private cotisations: 5.1%
 * - If member only has public cotisations (or none yet): 3.1%
 */
export async function getUserWalletFeeRate(userId: string): Promise<{
  feeRate: number;
  percentage: number;
  isPrivateMember: boolean;
  hasPublicAndPrivate: boolean;
}> {
  const approvedMemberships = await prisma.membership.findMany({
    where: {
      userId,
      status: "APPROVED",
    },
    select: {
      tontineSession: {
        select: {
          id: true,
          isPrivate: true,
        },
      },
    },
  });

  const hasPrivate = approvedMemberships.some((m) => m.tontineSession.isPrivate);
  const hasPublic = approvedMemberships.some((m) => !m.tontineSession.isPrivate);

  if (hasPrivate) {
    return {
      feeRate: 0.051,
      percentage: 5.1,
      isPrivateMember: true,
      hasPublicAndPrivate: hasPublic,
    };
  }

  return {
    feeRate: 0.031,
    percentage: 3.1,
    isPrivateMember: false,
    hasPublicAndPrivate: false,
  };
}

/**
 * Loads wallet details, balance, total cotisé, and transactions.
 * Transactions are limited to 30 days (1 month) for members; older records
 * are archived for the member but remain permanently stored for admins.
 */
export async function getUserWalletData(userId: string, options?: { includeAllForAdmin?: boolean }) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      walletBalance: true,
    },
  });

  if (!user) throw new Error("User not found");

  const feeInfo = await getUserWalletFeeRate(userId);

  // Total cotisé (sum of all PAID contributions across all user's slots)
  const paidContributions = await prisma.contribution.findMany({
    where: {
      status: "PAID",
      membershipSlot: {
        membership: {
          userId,
        },
      },
    },
    select: {
      amountPaid: true,
    },
  });

  const totalContributed = paidContributions.reduce(
    (sum, c) => sum + Number(c.amountPaid || 0),
    0
  );

  // Date boundary: 1 month (30 days ago) for member view
  const oneMonthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // 1. Direct wallet transactions (deposits, wallet payouts, etc.)
  const walletTxWhere = options?.includeAllForAdmin
    ? { userId }
    : { userId, createdAt: { gte: oneMonthAgo } };

  const walletTx = await prisma.walletTransaction.findMany({
    where: walletTxWhere,
    orderBy: { createdAt: "desc" },
  });

  // 2. Contributions history (payments made)
  const ownContributions = await prisma.contribution.findMany({
    where: {
      status: "PAID",
      membershipSlot: {
        membership: {
          userId,
        },
      },
      ...(options?.includeAllForAdmin ? {} : { dueDate: { gte: oneMonthAgo } }),
    },
    include: {
      membershipSlot: {
        include: {
          membership: {
            include: {
              tontineSession: {
                select: { title: true, type: true },
              },
            },
          },
        },
      },
    },
    orderBy: { dueDate: "desc" },
    take: options?.includeAllForAdmin ? 500 : 50,
  });

  // 3. Payouts received (cagnottes versées)
  const userPayouts = await prisma.payout.findMany({
    where: {
      status: { in: ["RELEASED", "CONFIRMED"] },
      membershipSlot: {
        membership: {
          userId,
        },
      },
      ...(options?.includeAllForAdmin ? {} : { releasedAt: { gte: oneMonthAgo } }),
    },
    include: {
      membershipSlot: {
        include: {
          membership: {
            include: {
              tontineSession: {
                select: { title: true, type: true },
              },
            },
          },
        },
      },
    },
    orderBy: { releasedAt: "desc" },
    take: options?.includeAllForAdmin ? 500 : 50,
  });

  // Aggregate operations
  const operations: WalletOperation[] = [];

  // Add wallet direct transactions
  for (const tx of walletTx) {
    const isCredit =
      tx.type === "DEPOSIT" ||
      tx.type === "PAYOUT" ||
      tx.type === "REFUND" ||
      tx.type === "LOAN_DISBURSEMENT";
    operations.push({
      id: `wtx-${tx.id}`,
      type: tx.type,
      direction: isCredit ? "IN" : "OUT",
      title:
        tx.type === "DEPOSIT"
          ? "Recharge portefeuille"
          : tx.type === "PAYOUT"
            ? "Cagnotte reçue"
            : tx.type === "WITHDRAWAL"
              ? "Retrait effectué"
              : tx.type === "REFUND"
                ? "Remboursement reçu"
                : tx.type === "LOAN_DISBURSEMENT"
                  ? "Prêt d'urgence reçu"
                  : tx.type === "LOAN_REPAYMENT"
                    ? "Remboursement prêt"
                    : "Opération portefeuille",
      subtitle: tx.description || "Recharge Mobile Money (Orange / MTN)",
      amount: Number(tx.amount),
      formattedAmount: `${isCredit ? "+" : "-"} ${formatXAF(Number(tx.amount))}`,
      fee: Number(tx.fee || 0),
      date: tx.createdAt.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }),
      timestamp: tx.createdAt.getTime(),
      rawDate: tx.createdAt,
      status: "SUCCESSFUL",
    });
  }

  // Add contributions
  for (const c of ownContributions) {
    const sessionTitle =
      c.membershipSlot.membership.tontineSession.title ||
      c.membershipSlot.membership.tontineSession.type;
    const dateObj = c.paidAt || c.dueDate;
    operations.push({
      id: `contrib-${c.id}`,
      type: "CONTRIBUTION",
      direction: "OUT",
      title: "Cotisation versée",
      subtitle: `${sessionTitle} · ${c.membershipSlot.beneficiaryName}`,
      amount: Number(c.amountPaid),
      formattedAmount: `- ${formatXAF(Number(c.amountPaid))}`,
      fee: Number(c.feePaid || 0),
      date: dateObj.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }),
      timestamp: dateObj.getTime(),
      rawDate: dateObj,
      status: "PAID",
    });
  }

  // Add payouts
  for (const p of userPayouts) {
    const sessionTitle =
      p.membershipSlot.membership.tontineSession.title ||
      p.membershipSlot.membership.tontineSession.type;
    const dateObj = p.releasedAt || p.dueDate;
    const netAmount = Number(p.netPayout || p.pot || 0);
    operations.push({
      id: `payout-${p.id}`,
      type: "PAYOUT",
      direction: "IN",
      title: "Cagnotte reçue (Bouffe)",
      subtitle: `${sessionTitle} · Tour ${p.membershipSlot.beneficiaryName}`,
      amount: netAmount,
      formattedAmount: `+ ${formatXAF(netAmount)}`,
      fee: Number(p.deducted || 0),
      date: dateObj.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }),
      timestamp: dateObj.getTime(),
      rawDate: dateObj,
      status: "CONFIRMED",
    });
  }

  // Sort chronologically (newest first)
  operations.sort((a, b) => b.timestamp - a.timestamp);

  // Count how many older operations exist
  const olderOperationsCount = options?.includeAllForAdmin
    ? 0
    : await prisma.contribution.count({
        where: {
          status: "PAID",
          membershipSlot: {
            membership: {
              userId,
            },
          },
          dueDate: { lt: oneMonthAgo },
        },
      });

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      walletBalance: Number(user.walletBalance || 0),
      formattedBalance: formatXAF(Number(user.walletBalance || 0)),
    },
    totalContributed,
    formattedTotalContributed: formatXAF(totalContributed),
    feeInfo,
    operations,
    olderOperationsCount,
  };
}
