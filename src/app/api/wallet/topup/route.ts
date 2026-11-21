import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getUserWalletFeeRate } from "@/lib/wallet";
import { creditWalletTx } from "@/lib/wallet-ledger";
import { normalizeCameroonPhone, initiateDirectPayment, getFapshiApiUser, getFapshiApiKey } from "@/lib/fapshi";
import { detectMobileMoneyProvider, fapshiMediumFor } from "@/lib/mobile-money-provider";
import { checkFinancialServiceAvailability } from "@/lib/financial-service-control";
import { getGlobalWithdrawalLimits } from "@/lib/withdrawal-limits";

const topUpSchema = z.object({
  amount: z.number().int().min(100, "Le montant minimum de rechargement est de 100 FCFA").max(50000000),
  phone: z.string().trim().min(9),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = topUpSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Données invalides" },
      { status: 400 }
    );
  }

  const { amount, phone: rawPhone } = parsed.data;

  const globalLimits = await getGlobalWithdrawalLimits();
  if (amount < globalLimits.minTopupAmount) {
    return NextResponse.json(
      {
        error: `Le montant minimum de rechargement est de ${globalLimits.minTopupAmount.toLocaleString("fr-FR")} FCFA.`,
      },
      { status: 400 }
    );
  }
  if (amount > globalLimits.maxTopupAmount) {
    return NextResponse.json(
      {
        error: `Le montant maximum de rechargement est de ${globalLimits.maxTopupAmount.toLocaleString("fr-FR")} FCFA par opération.`,
      },
      { status: 400 }
    );
  }

  const phone = normalizeCameroonPhone(rawPhone);
  if (!phone) {
    return NextResponse.json(
      { error: "Numéro de téléphone Orange Money ou MTN Mobile Money camerounais invalide." },
      { status: 400 }
    );
  }

  const provider = detectMobileMoneyProvider(phone);
  if (!provider) {
    return NextResponse.json(
      { error: "Le numéro doit être un numéro Orange Money ou MTN Mobile Money camerounais valide." },
      { status: 400 }
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

  // Determine recharge fee rate:
  // 5.1% if member has private cotisations (or both public and private)
  // 3.1% if member only has public cotisations
  const feeInfo = await getUserWalletFeeRate(session.user.id);
  const feeAmount = Math.round(amount * (feeInfo.percentage / 100));
  const totalDebit = amount + feeAmount;

  try {
    // Check daily deposit limit (500 000 FCFA / day limit for cash-in security, wallet balance storage remains unlimited)
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const todayDeposits = await prisma.walletTransaction.aggregate({
      where: {
        userId: session.user.id,
        type: "DEPOSIT",
        status: { in: ["SUCCESSFUL", "COMPLETED", "PENDING"] },
        createdAt: { gte: startOfDay },
      },
      _sum: { amount: true },
    });
    const currentDailyTotal = Number(todayDeposits._sum.amount || 0);
    const MAX_DAILY_DEPOSIT_XAF = 500_000;
    if (currentDailyTotal + amount > MAX_DAILY_DEPOSIT_XAF) {
      const remainingAllowed = Math.max(0, MAX_DAILY_DEPOSIT_XAF - currentDailyTotal);
      return NextResponse.json(
        {
          error: `Plafond de recharge journalier atteint (500 000 FCFA/jour). Vous avez déjà rechargé ${currentDailyTotal.toLocaleString("fr-FR")} FCFA aujourd'hui. Montant restant autorisé pour aujourd'hui : ${remainingAllowed.toLocaleString("fr-FR")} FCFA.`,
        },
        { status: 400 },
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, name: true, email: true, walletBalance: true },
    });

    if (!user) {
      return NextResponse.json({ error: "Utilisateur non trouvé" }, { status: 404 });
    }

    const providerLabel = provider === "ORANGE" ? "Orange Money" : "MTN Mobile Money";
    const hasFapshiConfig = Boolean(getFapshiApiUser() && getFapshiApiKey());

    if (hasFapshiConfig) {
      const fapshiResult = await initiateDirectPayment({
        amount: totalDebit,
        phone,
        medium: fapshiMediumFor(provider),
        name: user.name,
        email: user.email || undefined,
        userId: user.id,
        externalId: `WALLET_${user.id}_${Date.now()}`,
        message: `Recharge portefeuille DIVA Asso (+${amount} FCFA, frais ${feeInfo.percentage}%)`,
      });

      // Record pending transaction until Fapshi webhook confirms
      await prisma.walletTransaction.create({
        data: {
          userId: user.id,
          amount,
          fee: feeAmount,
          balanceBefore: Number(user.walletBalance || 0),
          balanceAfter: Number(user.walletBalance || 0) + amount,
          status: "PENDING",
          type: "DEPOSIT",
          description: `Recharge ${providerLabel} (${feeInfo.percentage}% de frais)`,
          fapshiTxRef: fapshiResult.transId,
          metadata: {
            provider,
            phone,
            requestedAmount: amount,
            feeAmount,
          },
        },
      });

      return NextResponse.json({
        ok: true,
        transId: fapshiResult.transId,
        link: fapshiResult.link,
        amount,
        fee: feeAmount,
        totalDebit,
        feePercentage: feeInfo.percentage,
        message: `Veuillez valider le débit de ${totalDebit.toLocaleString("fr-FR")} FCFA sur votre téléphone (${phone}).`,
      });
    } else {
      // In development or local demo when Fapshi is not configured:
      // Direct atomic credit via wallet ledger
      const ledger = await prisma.$transaction((tx) =>
        creditWalletTx(tx, {
          userId: user.id,
          amount,
          fee: feeAmount,
          type: "DEPOSIT",
          description: `Recharge ${providerLabel} (+${amount} FCFA, frais ${feeInfo.percentage}%)`,
          metadata: {
            provider,
            phone,
            requestedAmount: amount,
            feeAmount,
          },
        }),
      );

      return NextResponse.json({
        ok: true,
        amount,
        fee: feeAmount,
        totalDebit,
        feePercentage: feeInfo.percentage,
        newBalance: ledger.balanceAfter,
        reference: ledger.reference,
        message: `Portefeuille rechargé avec succès de ${amount.toLocaleString("fr-FR")} FCFA !`,
      });
    }
  } catch (err) {
    console.error("[api/wallet/topup POST] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur lors du rechargement du portefeuille" },
      { status: 500 }
    );
  }
}
