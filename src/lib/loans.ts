import { prisma } from "@/lib/prisma";
import { debitWalletTx, type PrismaTx } from "@/lib/wallet-ledger";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import { sendEmailSafe } from "@/lib/email/resend";
import { renderBrandedEmailHtml } from "@/lib/email/template";
import { formatXAF } from "@/lib/format-currency";

export const LOAN_MIN_STARS = 4;
export const LOAN_RISK_TOLERANCE_XAF = 10_000;
/**
 * Seuil d'approbation automatique basé sur le TOTAL À REMBOURSER (capital + intérêts + frais DIVA Asso) :
 * - <= 50 000 FCFA : décaissement automatique (si éligible selon le calcul du système)
 * - > 50 000 FCFA : demande en attente de validation manuelle par l'administrateur
 */
export const LOAN_AUTO_APPROVAL_LIMIT_XAF = 50_000;
export const LOAN_INITIAL_INTEREST_RATE = 0.15; // 15%
export const LOAN_DIVA_FEE_RATE = 0.02; // 2% Frais DIVA Asso (jamais afficher "2%" côté membre)
export const LOAN_DURATION_DAYS = 21;
export const LOAN_GRACE_DAYS = 2; // 2 jours après l'échéance à 18h00
export const LOAN_PENALTY_RATE_PER_STEP = 0.05; // +5% après 2 jours de retard
export const LOAN_PENALTY_STEP_DAYS = 2;
export const LOAN_MIN_AMOUNT_XAF = 1_000;

/**
 * Calcule la date limite exacte à 18h00 heure du Cameroun (17h00 UTC), 21 jours après originDate.
 */
export function computeLoanDueDateAt18h(originDate: Date = new Date()): Date {
  const cmrNow = new Date(originDate.getTime() + 60 * 60 * 1000);
  const y = cmrNow.getUTCFullYear();
  const m = cmrNow.getUTCMonth();
  const d = cmrNow.getUTCDate() + LOAN_DURATION_DAYS;
  // 18h00 UTC+1 === 17h00 UTC
  return new Date(Date.UTC(y, m, d, 17, 0, 0, 0));
}

export interface CollateralCalculationInput {
  /** Somme des cotisations futures restant à payer sur les noms déjà bouffés (D) */
  remainingDebtD: number;
  /** Somme réellement déjà cotisée (épargne acquise) sur les noms non encore bouffés (G) */
  guaranteedFutureGainG: number;
  /** Nombre de noms en cotisation publique active qui n'ont pas encore été bouffés */
  unpaidOutPublicSlotsCount: number;
}

export interface CollateralCalculationResult {
  remainingDebtD: number;
  guaranteedFutureGainG: number;
  netCollateral: number;
  bonusToleranceApplied: number;
  maxLoanAmount: number;
}

/**
 * Formule financière exacte et sécurisée :
 *   C_net = G (déjà cotisé sur noms non bouffés) - D (reste à cotiser sur noms déjà bouffés)
 *
 * Règle stricte :
 * - Si le membre a déjà bouffé tous ses noms (unpaidOutPublicSlotsCount <= 0) => Plafond = 0 FCFA.
 * - Si C_net <= 0 (aucun solde positif acquis en caisse) => Plafond = 0 FCFA (PAS de +10 000 FCFA).
 * - Si et seulement si C_net > 0 ET au moins un nom reste à bouffer => Plafond = C_net + 10 000 FCFA.
 */
export function calculateLoanCeiling(input: CollateralCalculationInput): CollateralCalculationResult {
  const remainingDebtD = Math.max(0, Math.round(input.remainingDebtD));
  const guaranteedFutureGainG = Math.max(0, Math.round(input.guaranteedFutureGainG));
  const netCollateral = guaranteedFutureGainG - remainingDebtD;

  if (input.unpaidOutPublicSlotsCount <= 0 || netCollateral <= 0) {
    return {
      remainingDebtD,
      guaranteedFutureGainG,
      netCollateral,
      bonusToleranceApplied: 0,
      maxLoanAmount: 0,
    };
  }

  return {
    remainingDebtD,
    guaranteedFutureGainG,
    netCollateral,
    bonusToleranceApplied: LOAN_RISK_TOLERANCE_XAF,
    maxLoanAmount: netCollateral + LOAN_RISK_TOLERANCE_XAF,
  };
}

/**
 * Generates system-defined loan amount tiers (user selects from system-calculated options,
 * never exceeding maxLoanAmount).
 */
export function buildSystemLoanOptions(maxLoanAmount: number): number[] {
  if (maxLoanAmount < LOAN_MIN_AMOUNT_XAF) return [];
  const raw = [
    Math.floor((maxLoanAmount * 0.25) / 500) * 500,
    Math.floor((maxLoanAmount * 0.5) / 500) * 500,
    Math.floor((maxLoanAmount * 0.75) / 500) * 500,
    maxLoanAmount,
  ];
  const unique = Array.from(
    new Set(raw.filter((v) => v >= LOAN_MIN_AMOUNT_XAF && v <= maxLoanAmount)),
  ).sort((a, b) => a - b);
  return unique;
}

/**
 * Computes initial loan terms for a requested principal.
 */
export function computeLoanTerms(principal: number, originDate: Date = new Date()) {
  const cleanPrincipal = Math.round(principal);
  const interestAmount = Math.round(cleanPrincipal * LOAN_INITIAL_INTEREST_RATE);
  const divaFeeAmount = Math.round(cleanPrincipal * LOAN_DIVA_FEE_RATE);
  const totalDue = cleanPrincipal + interestAmount + divaFeeAmount;
  const dueDate = computeLoanDueDateAt18h(originDate);
  const graceEndDate = new Date(
    dueDate.getTime() + LOAN_GRACE_DAYS * 24 * 60 * 60 * 1000,
  );
  // Validation Admin obligatoire dès que le montant total à rembourser (capital + intérêts + frais DIVA Asso) > 50 000 FCFA
  const requiresAdminApproval = totalDue > LOAN_AUTO_APPROVAL_LIMIT_XAF;

  return {
    principal: cleanPrincipal,
    interestRate: LOAN_INITIAL_INTEREST_RATE,
    interestAmount,
    divaFeeAmount,
    penaltyAmount: 0,
    totalDue,
    dueDate,
    graceEndDate,
    requiresAdminApproval,
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
  paidOutSlotsCount: number;
  unpaidOutSlotsCount: number;
  collateral: CollateralCalculationResult;
  allowedAmounts: number[];
  autoApprovalLimit: number;
  guaranteeSlotId: string | null;
  guaranteeSlotLabel: string | null;
}

/**
 * Evaluates full real-time loan eligibility for a member from the database.
 * Uses actual PAID contributions on un-eaten slots minus remaining contributions owed
 * on already-eaten slots. Enforces strict isolation from private cotisations.
 */
export async function evaluateUserLoanEligibility(userId: string): Promise<LoanEligibilityReport> {
  const [user, unpaidFinesCount, publicMemberships, existingLoan] = await Promise.all([
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
          },
        },
        slots: {
          include: {
            contributions: {
              where: { status: "PAID" },
              select: { amountPaid: true },
            },
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
        status: { in: ["PENDING_ADMIN", "ACTIVE", "OVERDUE"] },
      },
      select: { id: true, status: true },
    }),
  ]);

  const stars = user?.stars ?? 0;
  const hasFourStars = stars >= LOAN_MIN_STARS;
  const hasNoActiveFines = unpaidFinesCount === 0;
  const hasActivePublicParticipation = publicMemberships.length > 0;
  const hasExistingActiveLoan = Boolean(existingLoan);

  let remainingDebtD = 0;
  let guaranteedFutureGainG = 0;
  let unpaidOutPublicSlotsCount = 0;
  let paidOutPublicSlotsCount = 0;
  let guaranteeSlotId: string | null = null;
  let guaranteeSlotLabel: string | null = null;

  for (const membership of publicMemberships) {
    const sess = membership.tontineSession;
    const totalSessionSlots = Math.max(
      1,
      sess.memberships.reduce(
        (sum, m) => sum + (m.slots.length > 0 ? m.slots.length : (m.slotCount ?? 1)),
        0,
      ),
    );
    const unitAmount = Number(sess.amount);

    for (const slot of membership.slots) {
      const alreadyPaidOut = slot.payouts.length > 0;
      const paidRoundsOnSlot = slot.contributions.length;
      const totalPaidOnSlot = slot.contributions.reduce(
        (sum, c) => sum + Number(c.amountPaid || 0),
        0,
      );

      if (alreadyPaidOut) {
        paidOutPublicSlotsCount += 1;
        // Reste de noms/tours à cotiser sur ce nom déjà bouffé
        const remainingRounds = Math.max(0, totalSessionSlots - paidRoundsOnSlot);
        remainingDebtD += remainingRounds * unitAmount;
      } else {
        unpaidOutPublicSlotsCount += 1;
        // Épargne réellement déjà acquise dans la caisse sur ce nom non encore bouffé
        // (équivalent exact à : Pot Futur - Cotisations restantes dues sur ce nom)
        guaranteedFutureGainG += totalPaidOnSlot;
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

  const allowedAmounts = buildSystemLoanOptions(collateral.maxLoanAmount);
  const hasUnpaidOutSlots = unpaidOutPublicSlotsCount > 0;
  const reasons: string[] = [];

  if (user?.isBanned) {
    reasons.push("Votre compte est actuellement suspendu.");
  }
  if (!hasFourStars) {
    reasons.push(
      `Badge 4 étoiles minimum requis pour demander un prêt (vous avez actuellement ${stars}/5 étoiles). Chaque étoile s'obtient en terminant un cycle complet dans une cotisation publique sans jamais avoir eu d'amende.`,
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
      "Vous avez déjà bouffé tous vos noms dans vos cotisations publiques actives (aucun nom restant en garantie).",
    );
  }
  if (hasUnpaidOutSlots && collateral.netCollateral <= 0) {
    reasons.push(
      "Votre épargne nette acquise (cotisations déjà payées moins le reste dû sur vos noms déjà bouffés) est insuffisante pour débloquer un prêt.",
    );
  }
  if (hasExistingActiveLoan) {
    reasons.push(
      existingLoan?.status === "PENDING_ADMIN"
        ? "Vous avez déjà une demande de prêt en attente de validation par l'administrateur."
        : "Vous avez déjà un prêt d'urgence en cours. Remboursez-le avant d'en solliciter un nouveau.",
    );
  }

  const eligible =
    !user?.isBanned &&
    hasFourStars &&
    hasNoActiveFines &&
    hasActivePublicParticipation &&
    hasUnpaidOutSlots &&
    collateral.netCollateral > 0 &&
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
    paidOutSlotsCount: paidOutPublicSlotsCount,
    unpaidOutSlotsCount: unpaidOutPublicSlotsCount,
    collateral,
    allowedAmounts,
    autoApprovalLimit: LOAN_AUTO_APPROVAL_LIMIT_XAF,
    guaranteeSlotId,
    guaranteeSlotLabel,
  };
}

/**
 * Synchronizes accrued late penalties (+5% per 2 days after day 23) for a single user's open loans.
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
    const divaFee = Number(loan.divaFeeAmount || 0);
    const { isOverdue, penaltyAmount } = computeAccruedLoanPenalty(
      principal,
      loan.graceEndDate,
      now,
    );

    const newTotalDue = principal + interest + divaFee + penaltyAmount;
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
    const divaFee = Number(loan.divaFeeAmount || 0);
    const { penaltyAmount } = computeAccruedLoanPenalty(principal, loan.graceEndDate, now);
    const totalDue = principal + interest + divaFee + penaltyAmount;
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
  if (loan.status === "PENDING_ADMIN") {
    throw new Error("Ce prêt est encore en attente de validation par l'administrateur.");
  }
  if (loan.status === "REPAID" || loan.status === "DEDUCTED_FROM_POT" || loan.status === "REJECTED") {
    throw new Error("Ce prêt est déjà clôturé.");
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
      user: { select: { id: true, name: true, email: true, preferredLang: true } },
    },
  });

  let updatedCount = 0;
  let notifiedCount = 0;
  let day20RemindersSent = 0;

  for (const loan of openLoans) {
    const principal = Number(loan.principal);
    const interest = Number(loan.interestAmount);
    const divaFee = Number(loan.divaFeeAmount || 0);
    const prevPenalty = Number(loan.penaltyAmount || 0);
    const { isOverdue, penaltyAmount } = computeAccruedLoanPenalty(
      principal,
      loan.graceEndDate,
      now,
    );

    // 1. Rappel automatique au 20e jour (24h avant la date limite à 18h00)
    const oneDayBeforeDueMs = loan.dueDate.getTime() - 24 * 60 * 60 * 1000;
    if (
      loan.status === "ACTIVE" &&
      !loan.day20ReminderSentAt &&
      now.getTime() >= oneDayBeforeDueMs
    ) {
      const remaining = Math.max(0, Number(loan.totalDue) - Number(loan.totalPaid || 0));
      const dueDateLabel = loan.dueDate.toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "Africa/Douala",
      });
      await prisma.loan.update({
        where: { id: loan.id },
        data: { day20ReminderSentAt: now },
      });
      await scheduleInAppNotifications({
        type: "LOAN_OVERDUE",
        recipients: [
          {
            userId: loan.userId,
            message: `Rappel important : la date limite de remboursement de votre prêt (${formatXAF(remaining)}) est le ${dueDateLabel} à 18h00. Pensez à rembourser à temps pour éviter +5 % de pénalité après 2 jours de retard.`,
            actionUrl: "/loans",
          },
        ],
      }).catch(() => {});

      if (loan.user.email) {
        const subject = `DIVA Asso — Rappel de remboursement de votre prêt (${formatXAF(remaining)})`;
        const bodyText = `Bonjour ${loan.user.name},\n\nLa date limite de remboursement de votre prêt d'urgence arrive demain : le ${dueDateLabel} à 18h00.\n\n• Montant restant à rembourser : ${formatXAF(remaining)}\n\nVous pouvez rembourser dès maintenant depuis votre Portefeuille DIVA Asso ou par paiement direct Orange Money / MTN Mobile Money.\nPassé ce délai à 18h00, une pénalité de +5 % sera appliquée après 2 jours de retard.`;
        const html = renderBrandedEmailHtml({
          title: subject,
          bodyText,
          actionUrl: "/loans",
          actionLabel: "Rembourser mon prêt",
          lang: loan.user.preferredLang === "en" ? "en" : "fr",
        });
        await sendEmailSafe(loan.user.email, subject, html).catch(() => {});
      }
      day20RemindersSent += 1;
    }

    // 2. Pénalités de retard (+5% après 2 jours de retard)
    if (isOverdue && (penaltyAmount > prevPenalty || loan.status !== "OVERDUE")) {
      const newTotalDue = principal + interest + divaFee + penaltyAmount;
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
            message: `Retard sur votre prêt d'urgence : une pénalité de +5 % a été appliquée. Total restant dû : ${formatXAF(remaining)}. Remboursez vite depuis votre portefeuille ou par paiement direct.`,
            actionUrl: "/wallet",
          },
        ],
      }).catch(() => {});
      notifiedCount += 1;
    }
  }

  return { scanned: openLoans.length, updatedCount, notifiedCount, day20RemindersSent };
}
