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
    | "LOAN_REPAYMENT"
    | "RELATIVE_CONTRIBUTION";
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
  beneficiaryName?: string | null;
  payerPhone?: string | null;
  txRef?: string | null;
  receiptPdfUrl?: string | null;
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

  // 1. Direct wallet transactions (deposits, withdrawals, wallet-paid contributions, payouts, loans)
  // Strictly filter for confirmed/successful transactions for the wallet operations list.
  const walletTxWhere = options?.includeAllForAdmin
    ? { userId }
    : {
        userId,
        createdAt: { gte: oneMonthAgo },
        status: { in: ["SUCCESSFUL", "COMPLETED", "PAID"] },
      };

  // 1. Fetch wallet ledger, contributions, relative contributions, and payouts
  const [walletTx, pendingDeposits, ownContributions, relativeContributions, payouts] = await Promise.all([
    prisma.walletTransaction.findMany({
      where: walletTxWhere,
      orderBy: { createdAt: "desc" },
      take: options?.includeAllForAdmin ? 500 : 50,
    }),
    prisma.walletTransaction.findMany({
      where: {
        userId,
        status: "PENDING",
        type: "DEPOSIT",
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.contribution.findMany({
      where: {
        membershipSlot: { membership: { userId } },
        status: "PAID",
        ...(options?.includeAllForAdmin ? {} : { paidAt: { gte: oneMonthAgo } }),
      },
      include: {
        membershipSlot: {
          include: {
            membership: { include: { tontineSession: true } },
          },
        },
        paidByUser: { select: { name: true } },
      },
      orderBy: { paidAt: "desc" },
      take: options?.includeAllForAdmin ? 500 : 50,
    }),
    prisma.contribution.findMany({
      where: {
        paidByUserId: userId,
        status: "PAID",
        ...(options?.includeAllForAdmin ? {} : { paidAt: { gte: oneMonthAgo } }),
        membershipSlot: { membership: { userId: { not: userId } } },
      },
      include: {
        membershipSlot: {
          include: {
            membership: { include: { tontineSession: true, user: { select: { name: true } } } },
          },
        },
      },
      orderBy: { paidAt: "desc" },
      take: options?.includeAllForAdmin ? 500 : 50,
    }),
    prisma.payout.findMany({
      where: {
        membershipSlot: { membership: { userId } },
        status: { in: ["RELEASED", "CONFIRMED"] },
        ...(options?.includeAllForAdmin ? {} : { releasedAt: { gte: oneMonthAgo } }),
      },
      include: {
        membershipSlot: {
          include: {
            membership: { include: { tontineSession: true } },
          },
        },
      },
      orderBy: { releasedAt: "desc" },
      take: options?.includeAllForAdmin ? 200 : 20,
    }),
  ]);

  const formatDateTime = (d: Date) => {
    const dateStr = d.toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "Africa/Douala",
    });
    const timeStr = d.toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Africa/Douala",
    });
    return `${dateStr} à ${timeStr}`;
  };

  const operations: WalletOperation[] = [];
  const handledFapshiRefs = new Set<string>();

  // A. Wallet ledger transactions
  for (const tx of walletTx) {
    const isCredit =
      tx.type === "DEPOSIT" ||
      tx.type === "PAYOUT" ||
      tx.type === "REFUND" ||
      tx.type === "LOAN_DISBURSEMENT";
    if (tx.fapshiTxRef) handledFapshiRefs.add(tx.fapshiTxRef);

    const meta = (tx.metadata as Record<string, unknown> | null) ?? {};
    const metaPhone = typeof meta.phone === "string" ? meta.phone : user.phone;
    const metaBeneficiary = typeof meta.accountName === "string" ? meta.accountName : null;

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
                    : tx.type === "CONTRIBUTION"
                      ? "Cotisation versée via portefeuille"
                      : "Opération portefeuille",
      subtitle: tx.description || "Opération Portefeuille DIVA",
      amount: Number(tx.amount),
      formattedAmount: `${isCredit ? "+" : "-"} ${formatXAF(Number(tx.amount))}`,
      fee: Number(tx.fee || 0),
      date: formatDateTime(tx.createdAt),
      timestamp: tx.createdAt.getTime(),
      rawDate: tx.createdAt,
      status: tx.status === "COMPLETED" || tx.status === "SUCCESSFUL" || tx.status === "PAID" ? "Validé" : tx.status,
      beneficiaryName: metaBeneficiary || user.name,
      payerPhone: metaPhone,
      txRef: tx.fapshiTxRef || tx.id,
      receiptPdfUrl: null,
    });
  }

  // B. Relative contributions (cotisations pour un proche)
  for (const c of relativeContributions) {
    if (c.fapshiTxRef && handledFapshiRefs.has(c.fapshiTxRef)) continue;
    if (c.fapshiTxRef) handledFapshiRefs.add(c.fapshiTxRef);

    const sessionTitle =
      c.membershipSlot.membership.tontineSession.title ||
      c.membershipSlot.membership.tontineSession.type;
    const beneficiary = `${c.membershipSlot.beneficiaryName} (${c.membershipSlot.membership.user.name})`;
    const dateToUse = c.paidAt || c.createdAt;

    operations.push({
      id: `rel-contrib-${c.id}`,
      type: "RELATIVE_CONTRIBUTION",
      direction: "OUT",
      title: "Cotisation pour un proche",
      subtitle: `Cotisation pour un proche — ${sessionTitle} (${beneficiary})`,
      amount: Number(c.amountPaid),
      formattedAmount: `- ${formatXAF(Number(c.amountPaid))}`,
      fee: Number(c.feePaid || 0),
      date: formatDateTime(dateToUse),
      timestamp: dateToUse.getTime(),
      rawDate: dateToUse,
      status: "Validé",
      beneficiaryName: beneficiary,
      payerPhone: c.payerPhone || user.phone,
      txRef: c.fapshiTxRef || c.id,
      receiptPdfUrl: c.bulkPaymentId
        ? `/api/files/bulk-${c.bulkPaymentId}-payer.pdf`
        : c.receiptPdfUrl,
    });
  }

  // C. Own direct contributions (not already represented in walletTx)
  for (const c of ownContributions) {
    if (c.fapshiTxRef && handledFapshiRefs.has(c.fapshiTxRef)) continue;
    if (c.fapshiTxRef) handledFapshiRefs.add(c.fapshiTxRef);

    const sessionTitle =
      c.membershipSlot.membership.tontineSession.title ||
      c.membershipSlot.membership.tontineSession.type;
    const beneficiary = c.membershipSlot.beneficiaryName;
    const dateToUse = c.paidAt || c.createdAt;

    operations.push({
      id: `own-contrib-${c.id}`,
      type: "CONTRIBUTION",
      direction: "OUT",
      title: "Cotisation tontine",
      subtitle: `Cotisation — ${sessionTitle} (${beneficiary})`,
      amount: Number(c.amountPaid),
      formattedAmount: `- ${formatXAF(Number(c.amountPaid))}`,
      fee: Number(c.feePaid || 0),
      date: formatDateTime(dateToUse),
      timestamp: dateToUse.getTime(),
      rawDate: dateToUse,
      status: "Validé",
      beneficiaryName: beneficiary,
      payerPhone: c.payerPhone || user.phone,
      txRef: c.fapshiTxRef || c.id,
      receiptPdfUrl: c.bulkPaymentId
        ? `/api/files/bulk-${c.bulkPaymentId}-owner.pdf`
        : c.receiptPdfUrl,
    });
  }

  // D. Payouts received (gains de tontine)
  for (const p of payouts) {
    const sessionTitle =
      p.membershipSlot.membership.tontineSession.title ||
      p.membershipSlot.membership.tontineSession.type;
    const beneficiary = p.membershipSlot.beneficiaryName;
    const dateToUse = p.releasedAt || p.detailsSubmittedAt || new Date();
    const payoutAmt = Number(p.netPayout || p.pot || 0);

    operations.push({
      id: `payout-${p.id}`,
      type: "PAYOUT",
      direction: "IN",
      title: "Gain de tontine reçu",
      subtitle: `Cagnotte tontine — ${sessionTitle} (${beneficiary})`,
      amount: payoutAmt,
      formattedAmount: `+ ${formatXAF(payoutAmt)}`,
      fee: 0,
      date: formatDateTime(dateToUse),
      timestamp: dateToUse.getTime(),
      rawDate: dateToUse,
      status: "Validé",
      beneficiaryName: beneficiary,
      payerPhone: user.phone,
      txRef: p.fapshiTransId || p.id,
      receiptPdfUrl: `/api/payouts/${p.id}/receipt`,
    });
  }

  // Sort unified operations by date descending
  operations.sort((a, b) => b.timestamp - a.timestamp);

  // Count how many older wallet transactions exist
  const olderOperationsCount = options?.includeAllForAdmin
    ? 0
    : await prisma.walletTransaction.count({
        where: {
          userId,
          status: { in: ["SUCCESSFUL", "COMPLETED", "PAID"] },
          createdAt: { lt: oneMonthAgo },
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
    pendingDeposits: pendingDeposits.map((tx) => ({
      id: tx.id,
      amount: Number(tx.amount),
      fee: Number(tx.fee || 0),
      transId: tx.fapshiTxRef || "",
      date: formatDateTime(tx.createdAt),
      description: tx.description,
    })),
    olderOperationsCount,
  };
}
