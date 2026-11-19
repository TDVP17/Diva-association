import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getUserWalletFeeRate } from "@/lib/wallet";
import { creditWalletTx } from "@/lib/wallet-ledger";
import { normalizeCameroonPhone, initiateDirectPayment, getFapshiApiUser, getFapshiApiKey } from "@/lib/fapshi";
import { detectMobileMoneyProvider, fapshiMediumFor } from "@/lib/mobile-money-provider";
import { checkFinancialServiceAvailability } from "@/lib/financial-service-control";

const topUpSchema = z.object({
  amount: z.number().int().min(500, "Le montant minimum de rechargement est de 500 FCFA").max(10000000),
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
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, name: true, email: true, walletBalance: true },
    });

    if (!user) {
      return NextResponse.json({ error: "Utilisateur non trouvé" }, { status: 404 });
    }

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
          description: `Recharge Mobile Money ${provider} (${feeInfo.percentage}% de frais)`,
          fapshiTxRef: fapshiResult.transId,
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
        message: `Veuillez valider le débit de ${totalDebit} FCFA sur votre téléphone (${phone}).`,
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
          description: `Recharge portefeuille locale (+${amount} FCFA, frais ${feeInfo.percentage}%)`,
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
        message: `Portefeuille rechargé avec succès de ${amount} FCFA !`,
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
