import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  evaluateUserLoanEligibility,
  computeLoanTerms,
  syncLoanPenaltiesForUser,
  LOAN_MIN_AMOUNT_XAF,
} from "@/lib/loans";
import { creditWalletTx } from "@/lib/wallet-ledger";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import { sendEmailSafe } from "@/lib/email/resend";
import { renderBrandedEmailHtml } from "@/lib/email/template";
import { formatXAF } from "@/lib/format-currency";
import { logAudit } from "@/lib/audit";

const requestLoanSchema = z.object({
  amount: z.number().int().min(LOAN_MIN_AMOUNT_XAF, `Montant minimum : ${LOAN_MIN_AMOUNT_XAF} FCFA`),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const userId = session.user.id;

  // Keep any overdue penalties up to date in real time
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
      penaltyAmount: Number(l.penaltyAmount),
      totalDue: Number(l.totalDue),
      totalPaid: Number(l.totalPaid),
      remainingDue: Math.max(0, Number(l.totalDue) - Number(l.totalPaid)),
      status: l.status,
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

  // Re-evaluate all 3 cumulative conditions server-side
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

  if (amount > eligibility.collateral.maxLoanAmount) {
    return NextResponse.json(
      {
        error: `Le montant demandé (${formatXAF(amount)}) dépasse votre plafond maximal autorisé (${formatXAF(eligibility.collateral.maxLoanAmount)}).`,
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

  const { loan, ledger } = await prisma.$transaction(async (tx) => {
    const createdLoan = await tx.loan.create({
      data: {
        userId,
        principal: terms.principal,
        interestRate: terms.interestRate,
        interestAmount: terms.interestAmount,
        penaltyAmount: 0,
        totalDue: terms.totalDue,
        totalPaid: 0,
        status: "ACTIVE",
        dueDate: terms.dueDate,
        graceEndDate: terms.graceEndDate,
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

    // Credit principal immediately into member's DIVA Wallet
    const credit = await creditWalletTx(tx, {
      userId,
      amount: terms.principal,
      fee: 0,
      type: "LOAN_DISBURSEMENT",
      description: `Décaissement prêt d'urgence #${createdLoan.id.slice(-6).toUpperCase()} (échéance 21 jours)`,
      metadata: {
        loanId: createdLoan.id,
        interestAmount: terms.interestAmount,
        totalDue: terms.totalDue,
        dueDate: terms.dueDate.toISOString(),
      },
    });

    return { loan: createdLoan, ledger: credit };
  });

  const lang = user.preferredLang === "en" ? "en" : "fr";
  const dueDateLabel = terms.dueDate.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  await scheduleInAppNotifications({
    type: "LOAN_DISBURSED",
    recipients: [
      {
        userId,
        message:
          lang === "fr"
            ? `Prêt d'urgence de ${formatXAF(terms.principal)} versé dans votre Portefeuille DIVA ! Total à rembourser avant le ${dueDateLabel} : ${formatXAF(terms.totalDue)} (15% intérêts inclus).`
            : `Emergency loan of ${formatXAF(terms.principal)} credited to your DIVA Wallet! Total due by ${dueDateLabel}: ${formatXAF(terms.totalDue)} (15% interest included).`,
        actionUrl: "/loans",
      },
    ],
  }).catch(() => {});

  if (user.email) {
    const html = renderBrandedEmailHtml({
      title: lang === "fr" ? "Prêt d'urgence validé & versé 💳" : "Emergency Loan Disbursed 💳",
      bodyText:
        lang === "fr"
          ? `Bonjour ${user.name},\n\nVotre prêt d'urgence garanti de ${formatXAF(terms.principal)} a été crédité instantanément dans votre Portefeuille DIVA Asso.\n\n• Capital emprunté : ${formatXAF(terms.principal)}\n• Intérêts (15 %) : ${formatXAF(terms.interestAmount)}\n• Total à rembourser : ${formatXAF(terms.totalDue)}\n• Date d'échéance (21 jours) : ${dueDateLabel}\n• Période de grâce : 2 jours (pénalité +5% tous les 2 jours dès le 23e jour).\n\nNouveau solde portefeuille : ${formatXAF(ledger.balanceAfter)}.`
          : `Hello ${user.name},\n\nYour guaranteed emergency loan of ${formatXAF(terms.principal)} has been credited to your DIVA Asso Wallet.\n\n• Principal: ${formatXAF(terms.principal)}\n• Interest (15%): ${formatXAF(terms.interestAmount)}\n• Total due: ${formatXAF(terms.totalDue)}\n• Due date (21 days): ${dueDateLabel}\n\nNew wallet balance: ${formatXAF(ledger.balanceAfter)}.`,
      actionUrl: "/loans",
      actionLabel: lang === "fr" ? "Suivre mon prêt" : "Track My Loan",
      lang,
    });
    await sendEmailSafe(
      user.email,
      lang === "fr"
        ? `DIVA Asso — Prêt d'urgence de ${formatXAF(terms.principal)} versé`
        : `DIVA Asso — Emergency Loan of ${formatXAF(terms.principal)} Disbursed`,
      html,
    ).catch(() => {});
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
      totalDue: terms.totalDue,
      maxPlafond: eligibility.collateral.maxLoanAmount,
    },
    request,
  });

  return NextResponse.json(
    {
      ok: true,
      loanId: loan.id,
      principal: terms.principal,
      interestAmount: terms.interestAmount,
      totalDue: terms.totalDue,
      dueDate: terms.dueDate.toISOString(),
      newBalance: ledger.balanceAfter,
      message: `Félicitations ! ${formatXAF(terms.principal)} ont été crédités dans votre Portefeuille DIVA.`,
    },
    { status: 201 },
  );
}
