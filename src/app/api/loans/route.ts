import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  evaluateUserLoanEligibility,
  computeLoanTerms,
  syncLoanPenaltiesForUser,
  LOAN_MIN_AMOUNT_XAF,
  LOAN_AUTO_APPROVAL_LIMIT_XAF,
} from "@/lib/loans";
import { creditWalletTx } from "@/lib/wallet-ledger";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import { sendEmailSafe } from "@/lib/email/resend";
import { renderBrandedEmailHtml } from "@/lib/email/template";
import { formatXAF } from "@/lib/format-currency";
import { logAudit } from "@/lib/audit";

const requestLoanSchema = z.object({
  amount: z.number().int().min(LOAN_MIN_AMOUNT_XAF, `Montant minimum : ${LOAN_MIN_AMOUNT_XAF} FCFA`),
  termsAccepted: z.boolean().optional().default(true),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const userId = session.user.id;

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

  return NextResponse.json({
    eligibility,
    walletBalance: Number(user?.walletBalance || 0),
    loans: loans.map((l) => ({
      id: l.id,
      principal: Number(l.principal),
      interestRate: Number(l.interestRate),
      interestAmount: Number(l.interestAmount),
      divaFeeAmount: Number(l.divaFeeAmount || 0),
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
    })),
  });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const userId = session.user.id;

  const body = await request.json().catch(() => null);
  const parsed = requestLoanSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Montant de prêt invalide." },
      { status: 400 },
    );
  }
  const { amount } = parsed.data;

  // Re-evaluate strictly server-side from actual PAID contributions & payouts
  const eligibility = await evaluateUserLoanEligibility(userId);
  if (!eligibility.eligible) {
    return NextResponse.json(
      {
        error: eligibility.reasons[0] || "Vous ne remplissez pas les conditions d'éligibilité au prêt.",
        reasons: eligibility.reasons,
      },
      { status: 403 },
    );
  }

  // Strictly enforce system-calculated ceiling while letting user type any amount <= ceiling
  if (amount > eligibility.collateral.maxLoanAmount) {
    return NextResponse.json(
      {
        error: `Le montant demandé (${formatXAF(amount)}) dépasse votre montant maximum autorisé (${formatXAF(eligibility.collateral.maxLoanAmount)}).`,
      },
      { status: 400 },
    );
  }

  const now = new Date();
  const terms = computeLoanTerms(amount, now);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, preferredLang: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Utilisateur introuvable." }, { status: 404 });
  }

  const lang = user.preferredLang === "en" ? "en" : "fr";

  // Case A: Total repayable > 50,000 FCFA -> Mandatory Admin approval BEFORE wallet credit!
  if (terms.requiresAdminApproval) {
    const loan = await prisma.loan.create({
      data: {
        userId,
        principal: terms.principal,
        interestRate: terms.interestRate,
        interestAmount: terms.interestAmount,
        divaFeeAmount: terms.divaFeeAmount,
        penaltyAmount: 0,
        totalDue: terms.totalDue,
        totalPaid: 0,
        status: "PENDING_ADMIN",
        requiresAdminApproval: true,
        dueDate: terms.dueDate,
        graceEndDate: terms.graceEndDate,
        termsAcceptedAt: new Date(),
        guaranteeSlotId: eligibility.guaranteeSlotId,
        collateralSnapshot: {
          remainingDebtD: eligibility.collateral.remainingDebtD,
          guaranteedFutureGainG: eligibility.collateral.guaranteedFutureGainG,
          netCollateral: eligibility.collateral.netCollateral,
          maxLoanAmount: eligibility.collateral.maxLoanAmount,
          stars: eligibility.stars,
        },
      },
    });

    const admins = await prisma.user.findMany({
      where: { role: { in: ["ADMIN", "PRESIDENT"] }, isBanned: false },
      select: { id: true },
    });

    if (admins.length > 0) {
      await scheduleInAppNotifications({
        type: "ADMIN_BROADCAST",
        recipients: admins.map((a) => ({
          userId: a.id,
          message: `Demande de prêt (${formatXAF(terms.principal)} · Total à rembourser : ${formatXAF(terms.totalDue)}) soumise par ${user.name}. Validation Admin requise avant crédit du portefeuille.`,
          actionUrl: "/admin/loans",
        })),
      }).catch(() => { });
    }

    await logAudit({
      actorId: userId,
      actorRole: session.user.role,
      action: "emergency_loan_pending_admin",
      targetType: "Loan",
      targetId: loan.id,
      metadata: {
        principal: terms.principal,
        divaFeeAmount: terms.divaFeeAmount,
        totalDue: terms.totalDue,
        maxPlafond: eligibility.collateral.maxLoanAmount,
        autoApprovalLimit: LOAN_AUTO_APPROVAL_LIMIT_XAF,
      },
      request,
    });

    return NextResponse.json(
      {
        ok: true,
        loanId: loan.id,
        status: "PENDING_ADMIN",
        requiresAdminApproval: true,
        principal: terms.principal,
        interestAmount: terms.interestAmount,
        divaFeeAmount: terms.divaFeeAmount,
        totalDue: terms.totalDue,
        message: `Votre demande de prêt de ${formatXAF(terms.principal)} (total à rembourser : ${formatXAF(terms.totalDue)}) a été transmise à l'administrateur DIVA Asso. Votre portefeuille sera rechargé dès sa validation.`,
      },
      { status: 201 },
    );
  }

  // Case B: Total repayable <= 50,000 FCFA -> Automated instant disbursement into DIVA Asso Wallet
  const { loan, ledger } = await prisma.$transaction(async (tx) => {
    const createdLoan = await tx.loan.create({
      data: {
        userId,
        principal: terms.principal,
        interestRate: terms.interestRate,
        interestAmount: terms.interestAmount,
        divaFeeAmount: terms.divaFeeAmount,
        penaltyAmount: 0,
        totalDue: terms.totalDue,
        totalPaid: 0,
        status: "ACTIVE",
        requiresAdminApproval: false,
        dueDate: terms.dueDate,
        graceEndDate: terms.graceEndDate,
        termsAcceptedAt: new Date(),
        guaranteeSlotId: eligibility.guaranteeSlotId,
        collateralSnapshot: {
          remainingDebtD: eligibility.collateral.remainingDebtD,
          guaranteedFutureGainG: eligibility.collateral.guaranteedFutureGainG,
          netCollateral: eligibility.collateral.netCollateral,
          maxLoanAmount: eligibility.collateral.maxLoanAmount,
          stars: eligibility.stars,
        },
      },
    });

    const credit = await creditWalletTx(tx, {
      userId,
      amount: terms.principal,
      fee: 0,
      type: "LOAN_DISBURSEMENT",
      description: `Décaissement prêt d'urgence #${createdLoan.id.slice(-6).toUpperCase()}`,
      metadata: {
        loanId: createdLoan.id,
        interestAmount: terms.interestAmount,
        divaFeeAmount: terms.divaFeeAmount,
        totalDue: terms.totalDue,
        dueDate: terms.dueDate.toISOString(),
      },
    });

    return { loan: createdLoan, ledger: credit };
  });

  const dueDateLabel = terms.dueDate.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Africa/Douala",
  });

  await scheduleInAppNotifications({
    type: "LOAN_DISBURSED",
    recipients: [
      {
        userId,
        message:
          lang === "fr"
            ? `Prêt d'urgence de ${formatXAF(terms.principal)} crédité dans votre Portefeuille DIVA Asso ! Total à rembourser au plus tard le ${dueDateLabel} à 18h00 : ${formatXAF(terms.totalDue)}.`
            : `Emergency loan of ${formatXAF(terms.principal)} credited to your DIVA Asso Wallet! Total due by ${dueDateLabel} at 18:00: ${formatXAF(terms.totalDue)}.`,
        actionUrl: "/wallet",
      },
    ],
  }).catch(() => { });

  if (user.email) {
    const html = renderBrandedEmailHtml({
      title: lang === "fr" ? "Prêt d'urgence crédité dans votre portefeuille" : "Emergency Loan Credited",
      bodyText:
        lang === "fr"
          ? `Salut ${user.name},\n\nVotre prêt d'urgence de ${formatXAF(terms.principal)} a été crédité dans votre Portefeuille DIVA Asso.\n\n• Montant emprunté : ${formatXAF(terms.principal)}\n• Intérêts : ${formatXAF(terms.interestAmount)}\n• Frais DIVA Asso : ${formatXAF(terms.divaFeeAmount)}\n• Total à rembourser : ${formatXAF(terms.totalDue)}\n• Date limite de remboursement : ${dueDateLabel} à 18h00\n• Retard : passé le ${dueDateLabel} à 18h00, +5 % de pénalité après 2 jours de retard.\n\nNouveau solde portefeuille : ${formatXAF(ledger.balanceAfter)}.`
          : `Hello ${user.name},\n\nYour emergency loan of ${formatXAF(terms.principal)} has been credited to your DIVA Asso Wallet.\n\n• Principal: ${formatXAF(terms.principal)}\n• Interest: ${formatXAF(terms.interestAmount)}\n• DIVA Asso Fee: ${formatXAF(terms.divaFeeAmount)}\n• Total due: ${formatXAF(terms.totalDue)}\n• Repayment deadline: ${dueDateLabel} at 18:00\n\nNew wallet balance: ${formatXAF(ledger.balanceAfter)}.`,
      actionUrl: "/loans",
      actionLabel: lang === "fr" ? "Consulter mon prêt" : "View My Loan",
      lang,
    });
    await sendEmailSafe(
      user.email,
      lang === "fr"
        ? `DIVA Asso — Prêt d'urgence de ${formatXAF(terms.principal)} crédité`
        : `DIVA Asso — Emergency Loan of ${formatXAF(terms.principal)} Credited`,
      html,
    ).catch(() => { });
  }

  await logAudit({
    actorId: userId,
    actorRole: session.user.role,
    action: "emergency_loan_disbursed",
    targetType: "Loan",
    targetId: loan.id,
    metadata: {
      principal: terms.principal,
      interestAmount: terms.interestAmount,
      divaFeeAmount: terms.divaFeeAmount,
      totalDue: terms.totalDue,
      maxPlafond: eligibility.collateral.maxLoanAmount,
    },
    request,
  });

  return NextResponse.json(
    {
      ok: true,
      loanId: loan.id,
      status: "ACTIVE",
      requiresAdminApproval: false,
      principal: terms.principal,
      interestAmount: terms.interestAmount,
      divaFeeAmount: terms.divaFeeAmount,
      totalDue: terms.totalDue,
      dueDate: terms.dueDate.toISOString(),
      newBalance: ledger.balanceAfter,
      message: `Félicitations ! ${formatXAF(terms.principal)} ont été crédités dans votre Portefeuille DIVA Asso.`,
    },
    { status: 201 },
  );
}
