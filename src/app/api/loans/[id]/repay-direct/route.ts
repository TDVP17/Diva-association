import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { syncLoanPenaltiesForUser } from "@/lib/loans";
import {
  normalizeCameroonPhone,
  initiateDirectPayment,
  getPaymentStatus,
  getFapshiApiUser,
  getFapshiApiKey,
} from "@/lib/fapshi";
import { detectMobileMoneyProvider, fapshiMediumFor } from "@/lib/mobile-money-provider";
import { checkFinancialServiceAvailability } from "@/lib/financial-service-control";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import { formatXAF } from "@/lib/format-currency";
import { logAudit } from "@/lib/audit";

const DIRECT_LOAN_REPAY_FEE_RATE = 0.031; // 3.1% Orange Money / MTN MoMo operator fee

const initiateSchema = z.object({
  phone: z.string().trim().min(9, "Veuillez entrer un numéro Orange Money ou MTN valide."),
});

async function settleLoanDirectPayment(loanId: string, userId: string, paidAmount: number, feeAmount: number, phone: string, transId: string) {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const loan = await tx.loan.findUnique({ where: { id: loanId } });
    if (!loan || loan.status === "REPAID" || loan.status === "DEDUCTED_FROM_POT") return;

    const totalDue = Number(loan.totalDue);
    const newTotalPaid = Number(loan.totalPaid || 0) + paidAmount;
    const fullyRepaid = newTotalPaid >= totalDue;

    await tx.loan.update({
      where: { id: loanId },
      data: {
        totalPaid: Math.min(totalDue, newTotalPaid),
        status: fullyRepaid ? "REPAID" : loan.status,
        repayFapshiTransId: transId,
        ...(fullyRepaid ? { repaidAt: now } : {}),
      },
    });

    await tx.walletTransaction.create({
      data: {
        userId,
        amount: paidAmount,
        fee: feeAmount,
        status: "COMPLETED",
        type: "LOAN_REPAYMENT",
        description: `Remboursement prêt direct Mobile Money (${phone}) #${loanId.slice(-6).toUpperCase()}`,
        fapshiTxRef: transId,
        metadata: { loanId, directMobileMoney: true, phone, operatorFee: feeAmount },
      },
    });
  });

  await scheduleInAppNotifications({
    type: "LOAN_REPAID",
    recipients: [
      {
        userId,
        message: `Félicitations ! Votre prêt d'urgence (${formatXAF(paidAmount)}) a été intégralement remboursé par paiement direct Mobile Money (${phone}).`,
        actionUrl: "/wallet",
      },
    ],
  }).catch(() => {});
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id } = await context.params;

  const body = await request.json().catch(() => null);
  const parsed = initiateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Numéro invalide." },
      { status: 400 },
    );
  }

  const phone = normalizeCameroonPhone(parsed.data.phone);
  if (!phone) {
    return NextResponse.json(
      { error: "Numéro Orange Money ou MTN Mobile Money camerounais invalide." },
      { status: 400 },
    );
  }

  const provider = detectMobileMoneyProvider(phone);
  if (!provider) {
    return NextResponse.json(
      { error: "Opérateur non reconnu. Utilisez un numéro Orange Money ou MTN MoMo." },
      { status: 400 },
    );
  }

  // Enforce centralized financial availability control (Cash-In)
  const serviceCheck = await checkFinancialServiceAvailability({
    provider,
    direction: "IN",
  });
  if (!serviceCheck.allowed) {
    return NextResponse.json(
      {
        error:
          serviceCheck.message ||
          "Ce service est momentanément indisponible. Veuillez choisir un autre moyen de paiement ou réessayer ultérieurement.",
      },
      { status: 503 },
    );
  }

  await syncLoanPenaltiesForUser(userId);
  const loan = await prisma.loan.findFirst({
    where: { id, userId },
    include: { user: { select: { name: true, email: true } } },
  });

  if (!loan) {
    return NextResponse.json({ error: "Prêt introuvable." }, { status: 404 });
  }
  if (loan.status !== "ACTIVE" && loan.status !== "OVERDUE") {
    return NextResponse.json({ error: "Ce prêt n'est pas remboursable actuellement." }, { status: 400 });
  }

  const remainingDue = Math.max(0, Number(loan.totalDue) - Number(loan.totalPaid || 0));
  if (remainingDue <= 0) {
    return NextResponse.json({ error: "Ce prêt est déjà entièrement soldé." }, { status: 400 });
  }

  const operatorFee = Math.round(remainingDue * DIRECT_LOAN_REPAY_FEE_RATE);
  const totalDebit = remainingDue + operatorFee;

  const hasFapshi = Boolean(getFapshiApiUser() && getFapshiApiKey());
  if (hasFapshi) {
    try {
      const fapshiRes = await initiateDirectPayment({
        amount: totalDebit,
        phone,
        medium: fapshiMediumFor(provider),
        name: loan.user.name,
        email: loan.user.email || undefined,
        userId,
        externalId: `LOAN_REPAY_${loan.id}_${Date.now()}`,
        message: `Remboursement prêt DIVA Asso (${formatXAF(remainingDue)} + frais ${formatXAF(operatorFee)})`,
      });

      await prisma.loan.update({
        where: { id: loan.id },
        data: { repayFapshiTransId: fapshiRes.transId },
      });

      await logAudit({
        actorId: userId,
        actorRole: session.user.role,
        action: "loan_direct_repay_initiated",
        targetType: "Loan",
        targetId: loan.id,
        metadata: { remainingDue, operatorFee, totalDebit, phone, provider, transId: fapshiRes.transId },
        request,
      });

      return NextResponse.json({
        ok: true,
        status: "PENDING",
        transId: fapshiRes.transId,
        remainingDue,
        operatorFee,
        totalDebit,
        phone,
        message: `Veuillez confirmer le paiement de ${formatXAF(totalDebit)} sur votre téléphone (${phone}).`,
      });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Échec de l'initiation du paiement direct." },
        { status: 502 },
      );
    }
  }

  // Local dev fallback without Fapshi keys
  const localTransId = `LOCAL-REPAY-${Date.now()}`;
  await settleLoanDirectPayment(loan.id, userId, remainingDue, operatorFee, phone, localTransId);
  return NextResponse.json({
    ok: true,
    status: "SUCCESSFUL",
    fullyRepaid: true,
    transId: localTransId,
    remainingDue,
    operatorFee,
    totalDebit,
    message: `Prêt remboursé avec succès (${formatXAF(remainingDue)} + frais ${formatXAF(operatorFee)}) !`,
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id } = await context.params;
  const url = new URL(request.url);
  const transIdParam = url.searchParams.get("transId");
  const phoneParam = url.searchParams.get("phone") || "Mobile Money";

  const loan = await prisma.loan.findFirst({ where: { id, userId } });
  if (!loan) {
    return NextResponse.json({ error: "Prêt introuvable." }, { status: 404 });
  }
  if (loan.status === "REPAID") {
    return NextResponse.json({ status: "SUCCESSFUL", fullyRepaid: true });
  }

  const transId = transIdParam || loan.repayFapshiTransId;
  if (!transId) {
    return NextResponse.json({ status: "PENDING" });
  }

  try {
    const fapshiStatus = await getPaymentStatus(transId);
    const normalizedStatus = (fapshiStatus.status || "").toUpperCase();

    if (normalizedStatus === "SUCCESSFUL") {
      const remainingDue = Math.max(0, Number(loan.totalDue) - Number(loan.totalPaid || 0));
      const operatorFee = Math.round(remainingDue * DIRECT_LOAN_REPAY_FEE_RATE);
      await settleLoanDirectPayment(loan.id, userId, remainingDue, operatorFee, phoneParam, transId);
      return NextResponse.json({ status: "SUCCESSFUL", fullyRepaid: true });
    }
    if (normalizedStatus === "FAILED" || normalizedStatus === "EXPIRED") {
      return NextResponse.json({ status: normalizedStatus });
    }
    return NextResponse.json({ status: "PENDING" });
  } catch {
    return NextResponse.json({ status: "PENDING" });
  }
}

