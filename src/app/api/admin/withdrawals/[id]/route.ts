import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { creditWalletTx } from "@/lib/wallet-ledger";
import { sendPayout, FapshiPayoutError } from "@/lib/fapshi-payout";
import { fapshiMediumFor } from "@/lib/mobile-money-provider";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import { sendEmailSafe } from "@/lib/email/resend";
import { renderBrandedEmailHtml } from "@/lib/email/template";
import { formatXAF } from "@/lib/format-currency";
import { logAudit } from "@/lib/audit";

const decideSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  channel: z.enum(["FAPSHI", "DIRECT"]).default("FAPSHI"),
  reason: z.string().max(300).optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = decideSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Paramètres invalides" }, { status: 400 });
  }

  const withdrawal = await prisma.walletWithdrawal.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true, preferredLang: true } },
    },
  });
  if (!withdrawal) {
    return NextResponse.json({ error: "Demande de retrait introuvable" }, { status: 404 });
  }
  if (withdrawal.status !== "PENDING_ADMIN") {
    return NextResponse.json({ error: "Cette demande de retrait a déjà été traitée." }, { status: 409 });
  }

  const amount = Number(withdrawal.amount);
  const lang = withdrawal.user.preferredLang === "en" ? "en" : "fr";

  if (parsed.data.decision === "REJECT") {
    const reason = parsed.data.reason?.trim() || "Refusé par l'administrateur DIVA Asso.";

    await prisma.$transaction(async (tx) => {
      await tx.walletWithdrawal.update({
        where: { id: withdrawal.id },
        data: {
          status: "REJECTED",
          rejectionReason: reason,
          approvedByAdminId: admin.user.id,
          approvedAt: new Date(),
        },
      });

      // Atomically refund the reserved balance back into the member's wallet
      await creditWalletTx(tx, {
        userId: withdrawal.userId,
        amount,
        type: "REFUND",
        description: `Remboursement retrait refusé (${withdrawal.phone}) — ${reason}`,
        metadata: { withdrawalId: withdrawal.id, reason },
      });
    });

    await scheduleInAppNotifications({
      type: "WITHDRAWAL_REJECTED",
      recipients: [
        {
          userId: withdrawal.userId,
          message:
            lang === "fr"
              ? `Votre demande de retrait de ${formatXAF(amount)} vers ${withdrawal.phone} a été refusée (${reason}). Votre solde portefeuille a été recrédité.`
              : `Your withdrawal of ${formatXAF(amount)} to ${withdrawal.phone} was declined (${reason}). Your wallet balance has been refunded.`,
          actionUrl: "/wallet",
        },
      ],
    }).catch(() => {});

    await logAudit({
      actorId: admin.user.id,
      actorRole: admin.user.role,
      action: "wallet_withdrawal_rejected",
      targetType: "WalletWithdrawal",
      targetId: withdrawal.id,
      metadata: { amount, reason },
      request,
    });

    return NextResponse.json({ ok: true, status: "REJECTED" });
  }

  // APPROVE
  let fapshiTransId: string;
  if (
    parsed.data.channel === "FAPSHI" &&
    process.env.FAPSHI_PAYOUT_API_USER &&
    process.env.FAPSHI_PAYOUT_API_KEY
  ) {
    try {
      const res = await sendPayout({
        amount: Math.round(amount),
        phone: withdrawal.phone,
        medium: fapshiMediumFor(withdrawal.provider),
        name: withdrawal.accountName,
        externalId: `wdr-adm-${withdrawal.id}`,
        message: `Retrait validé DIVA Asso - ${withdrawal.accountName}`,
      });
      fapshiTransId = res.transId;
    } catch (err) {
      return NextResponse.json(
        {
          error:
            err instanceof FapshiPayoutError
              ? `${err.message}. Vous pouvez utiliser le mode 'Virement Direct (Manuel)' si votre solde Fapshi Payout est vide.`
              : "Échec de l'envoi Fapshi Payout.",
        },
        { status: 502 },
      );
    }
  } else {
    fapshiTransId = `ADMIN-DIRECT-${withdrawal.id.slice(-8).toUpperCase()}`;
  }

  await prisma.walletWithdrawal.update({
    where: { id: withdrawal.id },
    data: {
      status: "COMPLETED",
      fapshiTransId,
      approvedByAdminId: admin.user.id,
      approvedAt: new Date(),
    },
  });

  await scheduleInAppNotifications({
    type: "WITHDRAWAL_APPROVED",
    recipients: [
      {
        userId: withdrawal.userId,
        message:
          lang === "fr"
            ? `Votre retrait de ${formatXAF(amount)} vers ${withdrawal.provider} ${withdrawal.phone} a été validé et viré par DIVA Asso !`
            : `Your withdrawal of ${formatXAF(amount)} to ${withdrawal.provider} ${withdrawal.phone} has been approved and disbursed!`,
        actionUrl: "/wallet",
      },
    ],
  }).catch(() => {});

  if (withdrawal.user.email) {
    const html = renderBrandedEmailHtml({
      title: lang === "fr" ? "Retrait validé et viré ✅" : "Withdrawal Approved & Sent ✅",
      bodyText:
        lang === "fr"
          ? `Bonjour ${withdrawal.user.name},\n\nVotre retrait de ${formatXAF(amount)} vers votre numéro ${withdrawal.provider} ${withdrawal.phone} (${withdrawal.accountName}) a été approuvé et exécuté sans frais.\nRéférence : ${fapshiTransId}.`
          : `Hello ${withdrawal.user.name},\n\nYour withdrawal of ${formatXAF(amount)} to ${withdrawal.provider} ${withdrawal.phone} (${withdrawal.accountName}) has been approved and sent with 0% fees.\nReference: ${fapshiTransId}.`,
      actionUrl: "/wallet",
      actionLabel: lang === "fr" ? "Voir mon portefeuille" : "View My Wallet",
      lang,
    });
    await sendEmailSafe(
      withdrawal.user.email,
      lang === "fr"
        ? `DIVA Asso — Retrait de ${formatXAF(amount)} viré !`
        : `DIVA Asso — Withdrawal of ${formatXAF(amount)} Sent!`,
      html,
    ).catch(() => {});
  }

  await logAudit({
    actorId: admin.user.id,
    actorRole: admin.user.role,
    action: "wallet_withdrawal_approved",
    targetType: "WalletWithdrawal",
    targetId: withdrawal.id,
    metadata: { amount, channel: parsed.data.channel, fapshiTransId },
    request,
  });

  return NextResponse.json({ ok: true, status: "COMPLETED", fapshiTransId });
}
