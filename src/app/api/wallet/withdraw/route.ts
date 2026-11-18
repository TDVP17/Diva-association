import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  AUTO_WITHDRAWAL_LIMIT_XAF,
  verifyWalletPin,
  getWithdrawalLockStatus,
} from "@/lib/wallet-pin";
import {
  debitWalletTx,
  creditWalletTx,
  InsufficientWalletBalanceError,
} from "@/lib/wallet-ledger";
import { sendPayout, FapshiPayoutError } from "@/lib/fapshi-payout";
import { fapshiMediumFor } from "@/lib/mobile-money-provider";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import { formatXAF } from "@/lib/format-currency";
import { logAudit } from "@/lib/audit";

const withdrawSchema = z.object({
  amount: z.number().int().min(500, "Montant minimum de retrait : 500 FCFA").max(10_000_000),
  paymentMethodId: z.string().min(1, "Veuillez choisir un numéro de retrait validé."),
  pin: z.string().regex(/^\d{4}$/, "Veuillez saisir votre code PIN à 4 chiffres."),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const withdrawals = await prisma.walletWithdrawal.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  return NextResponse.json({
    withdrawals: withdrawals.map((w) => ({
      id: w.id,
      amount: Number(w.amount),
      phone: w.phone,
      provider: w.provider,
      accountName: w.accountName,
      status: w.status,
      requiresAdminApproval: w.requiresAdminApproval,
      fapshiTransId: w.fapshiTransId,
      rejectionReason: w.rejectionReason,
      createdAt: w.createdAt.toISOString(),
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
  const parsed = withdrawSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Données de retrait invalides." },
      { status: 400 },
    );
  }
  const { amount, paymentMethodId, pin } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      isBanned: true,
      walletBalance: true,
      walletPinHash: true,
      phoneChangedAt: true,
    },
  });

  if (!user || user.isBanned) {
    return NextResponse.json({ error: "Votre compte n'est pas autorisé à effectuer un retrait." }, { status: 403 });
  }

  // 1. Check 4-digit PIN (2FA Anti-piratage)
  if (!user.walletPinHash) {
    return NextResponse.json(
      { error: "Veuillez d'abord configurer votre code PIN de retrait à 4 chiffres." },
      { status: 403 },
    );
  }
  if (!verifyWalletPin(pin, user.walletPinHash)) {
    return NextResponse.json(
      { error: "Code PIN incorrect. Veuillez réessayer." },
      { status: 403 },
    );
  }

  // 2. Check 48-hour withdrawal lock after phone change
  const lockStatus = getWithdrawalLockStatus(user.phoneChangedAt);
  if (lockStatus.isLocked) {
    return NextResponse.json(
      {
        error: `Sécurité anti-piratage : les retraits sont verrouillés pendant encore ${lockStatus.remainingHours} heure(s) suite à un changement récent de numéro de téléphone.`,
      },
      { status: 423 },
    );
  }

  // 3. Verify KYC / Whitelist: withdrawal method MUST be APPROVED by DIVA Asso
  const method = await prisma.savedPaymentMethod.findFirst({
    where: { id: paymentMethodId, userId },
  });
  if (!method) {
    return NextResponse.json({ error: "Numéro de retrait introuvable." }, { status: 404 });
  }
  if (method.status !== "APPROVED") {
    return NextResponse.json(
      {
        error:
          "Ce numéro de retrait n'a pas encore été vérifié et validé par DIVA Asso. Tant qu'il reste en attente, aucun retrait automatique n'est possible.",
      },
      { status: 403 },
    );
  }

  const accountName = (method.accountName || user.name).trim();
  // Tout argent déjà dans le compte principal (Portefeuille DIVA) est retiré automatiquement
  // vers le numéro validé (protégé par PIN 4 chiffres + Whitelist + Lock 48h), sans repasser par l'Admin.
  const requiresAdminApproval = false;

  // 4. Atomic debit + create WalletWithdrawal
  let withdrawal;
  let balanceAfter = 0;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const debit = await debitWalletTx(tx, {
        userId,
        amount,
        fee: 0, // 0% fees for the member per Cahier des Charges
        type: "WITHDRAWAL",
        description: requiresAdminApproval
          ? `Demande de retrait vers ${method.provider} ${method.phone} (en attente validation Admin)`
          : `Retrait automatique vers ${method.provider} ${method.phone} (0% frais)`,
        metadata: {
          phone: method.phone,
          provider: method.provider,
          accountName,
          requiresAdminApproval,
        },
      });

      const created = await tx.walletWithdrawal.create({
        data: {
          userId,
          amount,
          phone: method.phone,
          provider: method.provider,
          accountName,
          status: requiresAdminApproval ? "PENDING_ADMIN" : "AUTO_PROCESSED",
          requiresAdminApproval,
        },
      });

      return { created, balanceAfter: debit.balanceAfter };
    });

    withdrawal = result.created;
    balanceAfter = result.balanceAfter;
  } catch (err) {
    if (err instanceof InsufficientWalletBalanceError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[api/wallet/withdraw POST] debit error:", err);
    return NextResponse.json({ error: "Erreur lors de l'initiation du retrait." }, { status: 500 });
  }

  // 5A. >= 50,000 FCFA -> Notify admins for manual approval
  if (requiresAdminApproval) {
    const admins = await prisma.user.findMany({
      where: { role: { in: ["ADMIN", "PRESIDENT"] }, isBanned: false },
      select: { id: true },
    });
    if (admins.length > 0) {
      await scheduleInAppNotifications({
        type: "WITHDRAWAL_PENDING_ADMIN",
        recipients: admins.map((a) => ({
          userId: a.id,
          message: `Demande de retrait importante : ${user.name} demande ${formatXAF(amount)} vers ${method.provider} ${method.phone} (${accountName}). Validation requise.`,
          actionUrl: "/admin/withdrawals",
        })),
      }).catch(() => {});
    }

    await logAudit({
      actorId: userId,
      actorRole: session.user.role,
      action: "wallet_withdrawal_pending_admin",
      targetType: "WalletWithdrawal",
      targetId: withdrawal.id,
      metadata: { amount, phone: method.phone, provider: method.provider },
      request,
    });

    return NextResponse.json({
      ok: true,
      withdrawalId: withdrawal.id,
      status: "PENDING_ADMIN",
      requiresAdminApproval: true,
      newBalance: balanceAfter,
      message: `Votre demande de retrait de ${formatXAF(amount)} (>= 50 000 FCFA) a été transmise à l'administrateur DIVA Asso pour validation sécurisée.`,
    });
  }

  // 5B. < 50,000 FCFA -> Instant automated Fapshi payout
  const hasFapshiPayout = Boolean(
    process.env.FAPSHI_PAYOUT_API_USER && process.env.FAPSHI_PAYOUT_API_KEY,
  );

  let fapshiTransId: string;
  if (hasFapshiPayout) {
    try {
      const payoutRes = await sendPayout({
        amount: Math.round(amount),
        phone: method.phone,
        medium: fapshiMediumFor(method.provider),
        name: accountName,
        externalId: `wdr-${withdrawal.id}`,
        message: `Retrait Portefeuille DIVA Asso - ${accountName}`,
      });
      fapshiTransId = payoutRes.transId;
    } catch (err) {
      // Automatic rollback/refund so user NEVER loses funds on Fapshi failure
      await prisma.$transaction(async (tx) => {
        await tx.walletWithdrawal.update({
          where: { id: withdrawal.id },
          data: {
            status: "FAILED",
            rejectionReason:
              err instanceof FapshiPayoutError
                ? err.message
                : "Échec du transfert Fapshi Payout",
          },
        });
        await creditWalletTx(tx, {
          userId,
          amount,
          type: "REFUND",
          description: `Remboursement automatique suite à l'échec du retrait ${method.phone}`,
          metadata: { withdrawalId: withdrawal.id },
        });
      });

      return NextResponse.json(
        {
          error:
            err instanceof FapshiPayoutError
              ? `Virement impossible (${err.message}). Votre solde portefeuille a été recrédité instantanément.`
              : "Le transfert opérateur a échoué. Votre solde portefeuille a été intégralement restitué.",
        },
        { status: 502 },
      );
    }
  } else {
    fapshiTransId = `AUTO-LOCAL-${withdrawal.id.slice(-8).toUpperCase()}`;
  }

  await prisma.walletWithdrawal.update({
    where: { id: withdrawal.id },
    data: {
      status: "COMPLETED",
      fapshiTransId,
    },
  });

  await logAudit({
    actorId: userId,
    actorRole: session.user.role,
    action: "wallet_withdrawal_auto_completed",
    targetType: "WalletWithdrawal",
    targetId: withdrawal.id,
    metadata: { amount, phone: method.phone, provider: method.provider, fapshiTransId },
    request,
  });

  return NextResponse.json({
    ok: true,
    withdrawalId: withdrawal.id,
    status: "COMPLETED",
    requiresAdminApproval: false,
    fapshiTransId,
    newBalance: balanceAfter,
    message: `Retrait automatique de ${formatXAF(amount)} effectué avec succès vers ${method.provider} ${method.phone} (0 % de frais) !`,
  });
}
