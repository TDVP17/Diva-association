import { prisma } from "@/lib/prisma";
import { debitWalletTx, type PrismaTx } from "@/lib/wallet-ledger";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import { formatXAF } from "@/lib/format-currency";

export const LOAN_MIN_STARS = 4;
export const LOAN_RISK_TOLERANCE_XAF = 10_000;
export const LOAN_INITIAL_INTEREST_RATE = 0.15; // 15%
export const LOAN_DURATION_DAYS = 21; // 3 weeks
export const LOAN_GRACE_DAYS = 2; // 2 days after day 21 (day 23 starts penalties)
export const LOAN_PENALTY_RATE_PER_STEP = 0.05; // +5% of principal
export const LOAN_PENALTY_STEP_DAYS = 2; // every 2 days past grace
export const LOAN_MIN_AMOUNT_XAF = 2_000;

export interface CollateralCalculationInput {
  /** Sum of future contributions owed on slots already paid out in active public tontines */
  remainingDebtD: number;
  /** Sum of future pots guaranteed on slots not yet paid out in active public tontines */
  guaranteedFutureGainG: number;
  /** Number of slots in active public tontines not yet paid out */
  unpaidOutPublicSlotsCount: number;
}

export interface CollateralCalculationResult {
  remainingDebtD: number;
  guaranteedFutureGainG: number;
  netCollateral: number;
  maxLoanAmount: number;
}

/**
 * Pure mathematical formula from Cahier des Charges Section 3.2:
 *   C_net = G - D
 *   Plafond Maximal = max(0, C_net) + 10 000 FCFA
 *   (Strictly 0 FCFA if the member has already received all their pots!)
 */
export function calculateLoanCeiling(input: CollateralCalculationInput): CollateralCalculationResult {
  const remainingDebtD = Math.max(0, Math.round(input.remainingDebtD));
  const guaranteedFutureGainG = Math.max(0, Math.round(input.guaranteedFutureGainG));
  const netCollateral = guaranteedFutureGainG - remainingDebtD;

  if (input.unpaidOutPublicSlotsCount <= 0) {
    return {
      remainingDebtD,
      guaranteedFutureGainG,
      netCollateral,
      maxLoanAmount: 0,
    };
  }

  const maxLoanAmount = Math.max(0, netCollateral) + LOAN_RISK_TOLERANCE_XAF;
  return {
    remainingDebtD,
    guaranteedFutureGainG,
    netCollateral,
    maxLoanAmount,
  };
}

/**
 * Computes initial loan terms for a requested principal.
 */
export function computeLoanTerms(principal: number, originDate: Date = new Date()) {
  const cleanPrincipal = Math.round(principal);
  const interestAmount = Math.round(cleanPrincipal * LOAN_INITIAL_INTEREST_RATE);
  const totalDue = cleanPrincipal + interestAmount;
  const dueDate = new Date(originDate.getTime() + LOAN_DURATION_DAYS * 24 * 60 * 60 * 1000);
  const graceEndDate = new Date(
    originDate.getTime() + (LOAN_DURATION_DAYS + LOAN_GRACE_DAYS) * 24 * 60 * 60 * 1000,
  );

  return {
    principal: cleanPrincipal,
    interestRate: LOAN_INITIAL_INTEREST_RATE,
    interestAmount,
    penaltyAmount: 0,
    totalDue,
    dueDate,
    graceEndDate,
  };
}

/**
 * Computes accrued late penalty per Section 3.3:
 * - Days 0..21: 0 penalty (ACTIVE)
 * - Days 21..23: 0 penalty (Grace period 48h)
 * - From Day 23 onward: +5% of principal every 2 days of additional delay
 */
export function computeAccruedLoanPenalty(
  principal: number,
  graceEndDate: Date,
  now: Date = new Date(),
): { isOverdue: boolean; penaltySteps: number; penaltyAmount: number } {
  const msPastGrace = now.getTime() - graceEndDate.getTime();
  if (msPastGrace <= 0) {
    return { isOverdue: false, penaltySteps: 0, penaltyAmount: 0 };
  }

  const daysPastGrace = msPastGrace / (24 * 60 * 60 * 1000);
  // Step 1 triggers immediately once past graceEndDate (day 23), step 2 at day 25, step 3 at day 27, etc.
  const penaltySteps = Math.floor(daysPastGrace / LOAN_PENALTY_STEP_DAYS) + 1;
  const penaltyPerStep = Math.round(principal * LOAN_PENALTY_RATE_PER_STEP);
  return {
    isOverdue: true,
    penaltySteps,
    penaltyAmount: penaltyPerStep * penaltySteps,
  };
}

export interface LoanEligibilityReport {
  eligible: boolean;
  reasons: string[];
  stars: number;
  hasFourStars: boolean;
  unpaidFinesCount: number;
  hasNoActiveFines: boolean;
  hasActivePublicParticipation: boolean;
  hasUnpaidOutSlots: boolean;
  hasExistingActiveLoan: boolean;
  collateral: CollateralCalculationResult;
  guaranteeSlotId: string | null;
  guaranteeSlotLabel: string | null;
}

/**
 * Evaluates full real-time loan eligibility for a member from the database.
 * Enforces all 3 cumulative conditions + isolation from private cotisations.
 */
export async function evaluateUserLoanEligibility(userId: string): Promise<LoanEligibilityReport> {
  const [user, unpaidFinesCount, publicMemberships, activeLoan] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, stars: true, isBanned: true },
    }),
    prisma.fine.count({
      where: {
        membershipSlot: { membership: { userId } },
        status: { in: ["UNPAID", "FAILED"] },
      },
    }),
    prisma.membership.findMany({
      where: {
        userId,
        status: "APPROVED",
        tontineSession: {
          isPrivate: false, // Strict isolation: ONLY public DIVA Asso cotisations!
          status: "ACTIVE",
        },
      },
      include: {
        tontineSession: {
          include: {
            memberships: {
              where: { status: "APPROVED" },
              include: { slots: { select: { id: true } } },
            },
            payouts: {
              where: { status: { in: ["RELEASED", "CONFIRMED"] } },
              select: { id: true, membershipSlotId: true },
            },
          },
        },
        slots: {
          include: {
            payouts: {
              where: { status: { in: ["RELEASED", "CONFIRMED"] } },
              select: { id: true },
            },
          },
          orderBy: { officialPosition: "asc" },
        },
      },
    }),
    prisma.loan.findFirst({
      where: {
        userId,
        status: { in: ["ACTIVE", "OVERDUE"] },
      },
      select: { id: true },
    }),
  ]);

  const stars = user?.stars ?? 0;
  const hasFourStars = stars >= LOAN_MIN_STARS;
  const hasNoActiveFines = unpaidFinesCount === 0;
  const hasActivePublicParticipation = publicMemberships.length > 0;
  const hasExistingActiveLoan = Boolean(activeLoan);

  let remainingDebtD = 0;
  let guaranteedFutureGainG = 0;
  let unpaidOutPublicSlotsCount = 0;
  let guaranteeSlotId: string | null = null;
  let guaranteeSlotLabel: string | null = null;

  for (const membership of publicMemberships) {
    const sess = membership.tontineSession;
    const totalSessionSlots = sess.memberships.reduce(
      (sum, m) => sum + (m.slots.length > 0 ? m.slots.length : (m.slotCount ?? 1)),
      0,
    );
    const completedRounds = sess.payouts.length;
    const remainingRounds = Math.max(0, totalSessionSlots - completedRounds);
    const unitContribution = Number(sess.amount) + Number(sess.fee);
    const estimatedPot = Number(sess.amount) * Math.max(1, totalSessionSlots);

    for (const slot of membership.slots) {
      const alreadyPaidOut = slot.payouts.length > 0;
      if (alreadyPaidOut) {
        // Slot already received its pot -> future contributions owed are debt D
        remainingDebtD += remainingRounds * unitContribution;
      } else {
        // Slot has NOT received its pot yet -> future pot is guaranteed gain G
        unpaidOutPublicSlotsCount += 1;
        guaranteedFutureGainG += estimatedPot;
        if (!guaranteeSlotId) {
          guaranteeSlotId = slot.id;
          guaranteeSlotLabel = `${sess.title || sess.type} — ${slot.beneficiaryName}`;
        }
      }
    }
  }

  const collateral = calculateLoanCeiling({
    remainingDebtD,
    guaranteedFutureGainG,
    unpaidOutPublicSlotsCount,
  });

  const hasUnpaidOutSlots = unpaidOutPublicSlotsCount > 0;
  const reasons: string[] = [];

  if (user?.isBanned) {
    reasons.push("Votre compte est actuellement suspendu.");
  }
  if (!hasFourStars) {
    reasons.push(
      `Badge 4 étoiles requis (vous avez actuellement ${stars}/5 étoiles). Terminez un cycle complet sans amende pour augmenter vos étoiles.`,
    );
  }
  if (!hasNoActiveFines) {
    reasons.push(
      `Vous avez ${unpaidFinesCount} amende(s) impayée(s). Toute amende active bloque l'accès aux prêts.`,
    );
  }
  if (!hasActivePublicParticipation) {
    reasons.push(
      "Vous devez participer à au moins une cotisation publique active DIVA Asso (les cotisations privées sont exclues).",
    );
  }
  if (!hasUnpaidOutSlots) {
    reasons.push(
      "Vous avez déjà bouffé tous vos noms dans vos cotisations publiques actives (aucun collatéral résiduel disponible).",
    );
  }
  if (hasExistingActiveLoan) {
    reasons.push("Vous avez déjà un prêt d'urgence en cours. Remboursez-le avant d'en solliciter un nouveau.");
  }

  const eligible =
    !user?.isBanned &&
    hasFourStars &&
    hasNoActiveFines &&
    hasActivePublicParticipation &&
    hasUnpaidOutSlots &&
    !hasExistingActiveLoan &&
    collateral.maxLoanAmount >= LOAN_MIN_AMOUNT_XAF;

  return {
    eligible,
    reasons,
    stars,
    hasFourStars,
    unpaidFinesCount,
    hasNoActiveFines,
    hasActivePublicParticipation,
    hasUnpaidOutSlots,
    hasExistingActiveLoan,
    collateral,
    guaranteeSlotId,
    guaranteeSlotLabel,
  };
}

/**
 * Synchronizes accrued late penalties (+5% per 2 days after day 23) for a single loan
 * or all active/overdue loans. Returns updated penalty & totalDue.
 */
export async function syncLoanPenaltiesForUser(userId: string, now: Date = new Date()) {
  const openLoans = await prisma.loan.findMany({
    where: {
      userId,
      status: { in: ["ACTIVE", "OVERDUE"] },
    },
  });

  for (const loan of openLoans) {
    const principal = Number(loan.principal);
    const interest = Number(loan.interestAmount);
    const { isOverdue, penaltyAmount } = computeAccruedLoanPenalty(
      principal,
      loan.graceEndDate,
      now,
    );

    const newTotalDue = principal + interest + penaltyAmount;
    const newStatus = isOverdue ? "OVERDUE" : loan.status;

    if (
      penaltyAmount !== Number(loan.penaltyAmount) ||
      newTotalDue !== Number(loan.totalDue) ||
      newStatus !== loan.status
    ) {
      await prisma.loan.update({
        where: { id: loan.id },
        data: {
          penaltyAmount,
          totalDue: newTotalDue,
          status: newStatus,
          ...(isOverdue ? { lastPenaltyAt: now } : {}),
        },
      });
    }
  }
}

/**
 * Automatic source deduction (Garantie Ultime, Section 3.3):
 * Called right when a member's payout pot is being released.
 * Deducts Principal + 15% Interest + Accrued Penalties from `availableNetPayout`.
 */
export async function deductActiveLoansFromPayoutTx(
  tx: PrismaTx,
  params: {
    userId: string;
    payoutId: string;
    availableNetPayout: number;
    now?: Date;
  },
): Promise<{
  totalLoanDeducted: number;
  remainingNetPayout: number;
  deductedLoanIds: string[];
}> {
  const now = params.now ?? new Date();
  const openLoans = await tx.loan.findMany({
    where: {
      userId: params.userId,
      status: { in: ["ACTIVE", "OVERDUE"] },
    },
    orderBy: { createdAt: "asc" },
  });

  if (openLoans.length === 0 || params.availableNetPayout <= 0) {
    return {
      totalLoanDeducted: 0,
      remainingNetPayout: params.availableNetPayout,
      deductedLoanIds: [],
    };
  }

  let remainingPot = params.availableNetPayout;
  let totalLoanDeducted = 0;
  const deductedLoanIds: string[] = [];

  for (const loan of openLoans) {
    if (remainingPot <= 0) break;

    const principal = Number(loan.principal);
    const interest = Number(loan.interestAmount);
    const { penaltyAmount } = computeAccruedLoanPenalty(principal, loan.graceEndDate, now);
    const totalDue = principal + interest + penaltyAmount;
    const alreadyPaid = Number(loan.totalPaid || 0);
    const remainingLoanDue = Math.max(0, totalDue - alreadyPaid);

    if (remainingLoanDue <= 0) continue;

    const deductedNow = Math.min(remainingPot, remainingLoanDue);
    const newTotalPaid = alreadyPaid + deductedNow;
    const fullySettled = newTotalPaid >= totalDue;

    await tx.loan.update({
      where: { id: loan.id },
      data: {
        penaltyAmount,
        totalDue,
        totalPaid: newTotalPaid,
        status: fullySettled ? "DEDUCTED_FROM_POT" : "OVERDUE",
        deductedFromPayoutId: params.payoutId,
        ...(fullySettled ? { repaidAt: now } : {}),
      },
    });

    await tx.walletTransaction.create({
      data: {
        userId: params.userId,
        amount: deductedNow,
        fee: 0,
        status: "COMPLETED",
        type: "LOAN_REPAYMENT",
        description: `Prélèvement automatique à la source sur cagnotte (Prêt #${loan.id.slice(-6).toUpperCase()})`,
        metadata: {
          loanId: loan.id,
          payoutId: params.payoutId,
          principal,
          interest,
          penaltyAmount,
          fullySettled,
        },
      },
    });

    remainingPot -= deductedNow;
    totalLoanDeducted += deductedNow;
    deductedLoanIds.push(loan.id);
  }

  return {
    totalLoanDeducted,
    remainingNetPayout: Math.max(0, remainingPot),
    deductedLoanIds,
  };
}

/**
 * Repay an active/overdue loan voluntarily from the user's DIVA Wallet.
 */
export async function repayLoanFromWallet(userId: string, loanId: string, amount?: number) {
  await syncLoanPenaltiesForUser(userId);

  const loan = await prisma.loan.findFirst({
    where: { id: loanId, userId },
  });
  if (!loan) {
    throw new Error("Prêt introuvable.");
  }
  if (loan.status === "REPAID" || loan.status === "DEDUCTED_FROM_POT") {
    throw new Error("Ce prêt est déjà entièrement remboursé.");
  }

  const remainingDue = Math.max(0, Number(loan.totalDue) - Number(loan.totalPaid));
  const payNow = amount ? Math.min(Math.round(amount), remainingDue) : remainingDue;
  if (payNow <= 0) {
    throw new Error("Montant de remboursement invalide.");
  }

  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const debit = await debitWalletTx(tx, {
      userId,
      amount: payNow,
      fee: 0,
      type: "LOAN_REPAYMENT",
      description: `Remboursement prêt d'urgence #${loan.id.slice(-6).toUpperCase()}`,
      metadata: { loanId: loan.id },
    });

    const newTotalPaid = Number(loan.totalPaid) + payNow;
    const fullyRepaid = newTotalPaid >= Number(loan.totalDue);

    const updatedLoan = await tx.loan.update({
      where: { id: loan.id },
      data: {
        totalPaid: newTotalPaid,
        status: fullyRepaid ? "REPAID" : loan.status,
        ...(fullyRepaid ? { repaidAt: now } : {}),
      },
    });

    return {
      updatedLoan,
      paidAmount: payNow,
      fullyRepaid,
      newBalance: debit.balanceAfter,
      reference: debit.reference,
    };
  });

  return result;
}

/**
 * Sweeps all open loans across the platform, applying +5% penalties every 2 days
 * past the 2-day grace period (day 23+) and notifying overdue borrowers.
 */
export async function runLoanPenaltySweep(now: Date = new Date()) {
  const openLoans = await prisma.loan.findMany({
    where: {
      status: { in: ["ACTIVE", "OVERDUE"] },
    },
    include: {
      user: { select: { id: true, name: true, preferredLang: true } },
    },
  });

  let updatedCount = 0;
  let notifiedCount = 0;

  for (const loan of openLoans) {
    const principal = Number(loan.principal);
    const interest = Number(loan.interestAmount);
    const prevPenalty = Number(loan.penaltyAmount || 0);
    const { isOverdue, penaltyAmount } = computeAccruedLoanPenalty(
      principal,
      loan.graceEndDate,
      now,
    );

    if (isOverdue && (penaltyAmount > prevPenalty || loan.status !== "OVERDUE")) {
      const newTotalDue = principal + interest + penaltyAmount;
      await prisma.loan.update({
        where: { id: loan.id },
        data: {
          penaltyAmount,
          totalDue: newTotalDue,
          status: "OVERDUE",
          lastPenaltyAt: now,
        },
      });
      updatedCount += 1;

      const remaining = Math.max(0, newTotalDue - Number(loan.totalPaid || 0));
      await scheduleInAppNotifications({
        type: "LOAN_OVERDUE",
        recipients: [
          {
            userId: loan.userId,
            message: `Retard sur votre prêt d'urgence : une pénalité de retard (+5%) a été appliquée. Total restant dû : ${formatXAF(remaining)}. Remboursez vite pour éviter un prélèvement sur votre cagnotte.`,
            actionUrl: "/loans",
          },
        ],
      }).catch(() => {});
      notifiedCount += 1;
    }
  }

  return { scanned: openLoans.length, updatedCount, notifiedCount };
}
