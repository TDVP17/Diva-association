import { prisma } from "@/lib/prisma";
import { getTontineConfig, computeFeeSplitAmounts } from "@/lib/tontine-engine";

const TONTINE_LABELS: Record<string, string> = {
  HEBDO_SUNDAY: "Weekly Tontine",
  MONTHLY_28: "Monthly Tontine (28th)",
  MONTHLY_25: "Monthly Tontine (25th)",
};

export interface SessionRevenue {
  id: string;
  title: string;
  fees: number;
  fines: number;
  total: number;
  grossReceived: number;
  presidentFeeShare: number;
  unpaidFines: number;
  successfulPayments: number;
  pendingPayments: number;
}

export interface RevenueAnalytics {
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
 * President-only global financial overview — computed strictly from PAID
 * contributions and PAID/DEDUCTED fines (never PENDING/LATE/UNPAID) so
 * these figures always reflect only successful, confirmed money. Shared by
 * the /admin/analytics page and its API route so the two never drift
 * apart the way the ledger split calculation once did.
 */
export async function getRevenueAnalytics(): Promise<RevenueAnalytics> {
  const sessions = await prisma.tontineSession.findMany({
    select: {
      id: true,
      title: true,
      type: true,
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
  });

  const perSession: SessionRevenue[] = sessions.map((s) => {
    const slots = s.memberships.flatMap((m) => m.slots);
    const contributions = slots.flatMap((slot) => slot.contributions);
    const fines = slots.flatMap((slot) => slot.fines);

    const paid = contributions.filter((c) => c.status === "PAID");
    const pending = contributions.filter((c) => c.status === "PENDING" || c.status === "LATE");

    const fees = paid.reduce((sum, c) => sum + Number(c.feePaid), 0);
    const grossReceived = paid.reduce(
      (sum, c) => sum + Number(c.amountPaid) + Number(c.feePaid) + Number(c.finePaid) + Number(c.providerFeeAmount ?? 0),
      0,
    );
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
      fees,
      fines: finesCollected,
      total: fees + finesCollected,
      grossReceived,
      presidentFeeShare: presidentAdminFeeShare + presidentGatewayFeeShare,
      unpaidFines: finesUnpaid,
      successfulPayments: paid.length,
      pendingPayments: pending.length,
    };
  });

  return {
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
