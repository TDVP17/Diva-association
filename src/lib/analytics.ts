import { prisma } from "@/lib/prisma";
import { getTontineConfig, computeFeeSplitAmounts } from "@/lib/tontine-engine";

const TONTINE_LABELS: Record<string, string> = {
  HEBDO_SUNDAY: "Cotisation Hebdomadaire",
  MONTHLY_28: "Cotisation Mensuelle (28)",
  MONTHLY_25: "Cotisation Mensuelle (25)",
};

export interface SessionRevenue {
  id: string;
  title: string;
  isPrivate: boolean;
  fees: number;
  fines: number;
  total: number;
  grossReceived: number;
  moneyIn: number;
  moneyOut: number;
  fapshiFee: number;
  divaMargin: number;
  presidentFeeShare: number;
  unpaidFines: number;
  successfulPayments: number;
  pendingPayments: number;
}

export interface RevenueAnalytics {
  // Cotisations Publiques
  public: {
    totalMoneyIn: number;
    totalMoneyOut: number;
    totalFeesIn: number;
    totalFeesOut: number;
    balance: number;
  };
  // Cotisations Privées
  private: {
    totalMoneyIn: number;
    totalMoneyOut: number;
    totalFeesIn: number;
    divaMargin2Percent: number;
    adminRest: number;
  };
  // Portefeuilles des membres
  totalMembersWalletBalance: number;
  totalUsersWithWallet: number;

  // Globaux
  totalFees: number;
  totalFines: number;
  totalRevenue: number;
  totalGrossReceived: number;
  totalPresidentFeeShare: number;
  totalUnpaidFines: number;
  totalSuccessfulPayments: number;
  totalPendingPayments: number;
  sessions: SessionRevenue[];
}

/**
 * Global financial analytics with clear breakdown between:
 * 1. Cotisations Publiques (Total entré, Total sorti, Frais entrés, Frais sortis)
 * 2. Cotisations Privées (Total entré, Total sorti/bouffé, Marge 2% Diva Asso, Reste admin)
 * 3. Total soldes portefeuilles des membres
 */
export async function getRevenueAnalytics(): Promise<RevenueAnalytics> {
  const [sessions, walletAgg] = await Promise.all([
    prisma.tontineSession.findMany({
      select: {
        id: true,
        title: true,
        type: true,
        isPrivate: true,
        payouts: {
          where: { status: { in: ["RELEASED", "CONFIRMED"] } },
          select: { netPayout: true, pot: true, deducted: true },
        },
        memberships: {
          select: {
            slots: {
              select: {
                contributions: {
                  select: {
                    status: true,
                    amountPaid: true,
                    feePaid: true,
                    finePaid: true,
                    providerFeeAmount: true,
                    presidentFeeShareAmount: true,
                  },
                },
                fines: { select: { status: true, amount: true } },
              },
            },
          },
        },
      },
      orderBy: { startDate: "desc" },
    }),
    prisma.user.aggregate({
      _sum: { walletBalance: true },
      _count: { id: true },
    }),
  ]);

  const totalMembersWalletBalance = Number(walletAgg._sum.walletBalance || 0);
  const totalUsersWithWallet = walletAgg._count.id;

  const perSession: SessionRevenue[] = sessions.map((s) => {
    const isPrivate = Boolean(s.isPrivate);
    const slots = s.memberships.flatMap((m) => m.slots);
    const contributions = slots.flatMap((slot) => slot.contributions);
    const fines = slots.flatMap((slot) => slot.fines);

    const paid = contributions.filter((c) => c.status === "PAID");
    const pending = contributions.filter((c) => c.status === "PENDING" || c.status === "LATE");

    const moneyIn = paid.reduce((sum, c) => sum + Number(c.amountPaid || 0), 0);
    const fees = paid.reduce((sum, c) => sum + Number(c.feePaid || 0), 0);
    const grossReceived = paid.reduce(
      (sum, c) => sum + Number(c.amountPaid) + Number(c.feePaid) + Number(c.finePaid) + Number(c.providerFeeAmount ?? 0),
      0,
    );

    const moneyOut = s.payouts.reduce((sum, p) => sum + Number(p.netPayout || p.pot || 0), 0);
    const fapshiFee = Math.round(moneyIn * 0.031); // 3.1% Fapshi
    const divaMargin = isPrivate ? Math.round(moneyIn * 0.02) : 0; // 2% marge Diva pour cotisations privées

    const { feeSplit } = getTontineConfig(s.type);
    const presidentAdminFeeShare = feeSplit ? computeFeeSplitAmounts(fees, feeSplit).president : 0;
    const presidentGatewayFeeShare = paid.reduce((sum, c) => sum + Number(c.presidentFeeShareAmount ?? 0), 0);

    const finesCollected = fines
      .filter((f) => f.status === "PAID" || f.status === "DEDUCTED")
      .reduce((sum, f) => sum + Number(f.amount), 0);
    const finesUnpaid = fines.filter((f) => f.status === "UNPAID").reduce((sum, f) => sum + Number(f.amount), 0);

    return {
      id: s.id,
      title: s.title || TONTINE_LABELS[s.type] || s.type,
      isPrivate,
      fees,
      fines: finesCollected,
      total: fees + finesCollected,
      grossReceived,
      moneyIn,
      moneyOut,
      fapshiFee,
      divaMargin,
      presidentFeeShare: presidentAdminFeeShare + presidentGatewayFeeShare,
      unpaidFines: finesUnpaid,
      successfulPayments: paid.length,
      pendingPayments: pending.length,
    };
  });

  // Calculs Cotisations Publiques
  const publicSessions = perSession.filter((s) => !s.isPrivate);
  const publicMoneyIn = publicSessions.reduce((sum, s) => sum + s.moneyIn, 0);
  const publicMoneyOut = publicSessions.reduce((sum, s) => sum + s.moneyOut, 0);
  const publicFeesIn = publicSessions.reduce((sum, s) => sum + s.fees, 0);
  const publicFeesOut = Math.round(publicMoneyIn * 0.031);

  // Calculs Cotisations Privées
  const privateSessions = perSession.filter((s) => s.isPrivate);
  const privateMoneyIn = privateSessions.reduce((sum, s) => sum + s.moneyIn, 0);
  const privateMoneyOut = privateSessions.reduce((sum, s) => sum + s.moneyOut, 0);
  const privateFeesIn = privateSessions.reduce((sum, s) => sum + s.fees, 0);
  const privateDivaMargin = Math.round(privateMoneyIn * 0.02); // 2% net Diva Asso
  const privateAdminRest = Math.max(0, privateMoneyIn - privateMoneyOut);

  return {
    public: {
      totalMoneyIn: publicMoneyIn,
      totalMoneyOut: publicMoneyOut,
      totalFeesIn: publicFeesIn,
      totalFeesOut: publicFeesOut,
      balance: publicMoneyIn - publicMoneyOut,
    },
    private: {
      totalMoneyIn: privateMoneyIn,
      totalMoneyOut: privateMoneyOut,
      totalFeesIn: privateFeesIn,
      divaMargin2Percent: privateDivaMargin,
      adminRest: privateAdminRest,
    },
    totalMembersWalletBalance,
    totalUsersWithWallet,
    totalFees: perSession.reduce((sum, s) => sum + s.fees, 0),
    totalFines: perSession.reduce((sum, s) => sum + s.fines, 0),
    totalRevenue: perSession.reduce((sum, s) => sum + s.total, 0),
    totalGrossReceived: perSession.reduce((sum, s) => sum + s.grossReceived, 0),
    totalPresidentFeeShare: perSession.reduce((sum, s) => sum + s.presidentFeeShare, 0),
    totalUnpaidFines: perSession.reduce((sum, s) => sum + s.unpaidFines, 0),
    totalSuccessfulPayments: perSession.reduce((sum, s) => sum + s.successfulPayments, 0),
    totalPendingPayments: perSession.reduce((sum, s) => sum + s.pendingPayments, 0),
    sessions: perSession,
  };
}
