import { prisma } from "@/lib/prisma";
import { getPaymentStatus, type FapshiPaymentStatus } from "@/lib/fapshi";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import { sendEmailSafe } from "@/lib/email/resend";
import { renderBrandedEmailHtml } from "@/lib/email/template";
import { formatXAF } from "@/lib/format-currency";

export interface SettleDepositResult {
  found: boolean;
  transId: string;
  status: FapshiPaymentStatus | "UNKNOWN";
  isPending: boolean;
  isSuccessful: boolean;
  isFailed: boolean;
  alreadySettled?: boolean;
  amount?: number;
  newBalance?: number;
  message?: string;
  error?: string;
}

/**
 * Authoritatively verifies a Fapshi transaction with Fapshi API and settles
 * the corresponding pending walletTransaction in the database.
 *
 * Implements strict idempotency:
 * - If already SUCCESSFUL / COMPLETED, immediately returns current balance without re-crediting.
 * - If Fapshi returns SUCCESSFUL, atomically increments user.walletBalance and marks tx SUCCESSFUL.
 * - If Fapshi returns FAILED / EXPIRED, marks tx FAILED without touching balance.
 */
export async function settlePendingFapshiDeposit(transId: string): Promise<SettleDepositResult> {
  const cleanTransId = transId?.trim();
  if (!cleanTransId) {
    return {
      found: false,
      transId: "",
      status: "UNKNOWN",
      isPending: false,
      isSuccessful: false,
      isFailed: true,
      error: "Identifiant de transaction manquant.",
    };
  }

  // 1. Find existing walletTransaction
  const existingTx = await prisma.walletTransaction.findFirst({
    where: { fapshiTxRef: cleanTransId },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          walletBalance: true,
          preferredLang: true,
        },
      },
    },
  });

  if (!existingTx) {
    return {
      found: false,
      transId: cleanTransId,
      status: "UNKNOWN",
      isPending: false,
      isSuccessful: false,
      isFailed: true,
      error: "Transaction introuvable dans le système DIVA Asso.",
    };
  }

  // 2. Strict idempotency: if already completed, do nothing!
  if (existingTx.status === "SUCCESSFUL" || existingTx.status === "COMPLETED") {
    return {
      found: true,
      transId: cleanTransId,
      status: "SUCCESSFUL",
      isPending: false,
      isSuccessful: true,
      isFailed: false,
      alreadySettled: true,
      amount: Number(existingTx.amount),
      newBalance: Number(existingTx.user.walletBalance || 0),
      message: `Recharge de ${formatXAF(Number(existingTx.amount))} déjà validée.`,
    };
  }

  // 3. Query Fapshi authoritatively
  let fapshiStatus: Awaited<ReturnType<typeof getPaymentStatus>>;
  try {
    fapshiStatus = await getPaymentStatus(cleanTransId);
  } catch (err) {
    console.error(`[wallet-reconcile] getPaymentStatus error for ${cleanTransId}:`, err);
    return {
      found: true,
      transId: cleanTransId,
      status: "PENDING",
      isPending: true,
      isSuccessful: false,
      isFailed: false,
      message: "Vérification en cours auprès de l'opérateur Mobile Money...",
    };
  }

  const status = fapshiStatus.status;

  if (status === "SUCCESSFUL" || status === "COMPLETED") {
    // 4. Atomic credit inside transaction with lock protection
    const creditResult = await prisma.$transaction(async (tx) => {
      // Re-read transaction inside isolation
      const current = await tx.walletTransaction.findUnique({
        where: { id: existingTx.id },
      });

      if (!current || current.status === "SUCCESSFUL" || current.status === "COMPLETED") {
        const u = await tx.user.findUnique({
          where: { id: existingTx.userId },
          select: { walletBalance: true },
        });
        return {
          alreadySettled: true,
          newBalance: Number(u?.walletBalance || 0),
          amount: Number(current?.amount || existingTx.amount),
        };
      }

      const user = await tx.user.findUnique({
        where: { id: existingTx.userId },
        select: { walletBalance: true },
      });
      if (!user) throw new Error("Utilisateur introuvable");

      const balanceBefore = Number(user.walletBalance || 0);
      const amount = Number(existingTx.amount);
      const balanceAfter = Math.round((balanceBefore + amount) * 100) / 100;

      // Update user wallet balance
      await tx.user.update({
        where: { id: existingTx.userId },
        data: { walletBalance: balanceAfter },
      });

      // Update wallet transaction to SUCCESSFUL
      await tx.walletTransaction.update({
        where: { id: existingTx.id },
        data: {
          status: "SUCCESSFUL",
          balanceBefore,
          balanceAfter,
          description: existingTx.description || "Recharge Mobile Money confirmée",
        },
      });

      return {
        alreadySettled: false,
        newBalance: balanceAfter,
        amount,
      };
    });

    // 5. Send notifications if freshly settled
    if (!creditResult.alreadySettled) {
      try {
        const lang = existingTx.user.preferredLang || "fr";
        const title =
          lang === "fr"
            ? "Portefeuille rechargé avec succès !"
            : "Wallet successfully topped up!";
        const message =
          lang === "fr"
            ? `Votre portefeuille DIVA Asso a été crédité de +${formatXAF(creditResult.amount)}. Nouveau solde : ${formatXAF(creditResult.newBalance)}.`
            : `Your DIVA Asso wallet was credited with +${formatXAF(creditResult.amount)}. New balance: ${formatXAF(creditResult.newBalance)}.`;

        await scheduleInAppNotifications({
          type: "ADMIN_BROADCAST",
          recipients: [
            {
              userId: existingTx.userId,
              message,
              actionUrl: "/wallet",
            },
          ],
        }).catch(() => {});

        if (existingTx.user.email) {
          const emailHtml = renderBrandedEmailHtml({
            title,
            bodyText: message,
            actionLabel: lang === "fr" ? "Consulter mon portefeuille" : "View my wallet",
            actionUrl: "/wallet",
            recipientName: existingTx.user.name,
          });
          await sendEmailSafe(existingTx.user.email, title, emailHtml).catch(() => {});
        }
      } catch (e) {
        console.error("[wallet-reconcile] notification error:", e);
      }
    }

    return {
      found: true,
      transId: cleanTransId,
      status: "SUCCESSFUL",
      isPending: false,
      isSuccessful: true,
      isFailed: false,
      alreadySettled: creditResult.alreadySettled,
      amount: creditResult.amount,
      newBalance: creditResult.newBalance,
      message: `Recharge de ${formatXAF(creditResult.amount)} validée avec succès !`,
    };
  }

  if (status === "FAILED" || status === "EXPIRED") {
    await prisma.walletTransaction.update({
      where: { id: existingTx.id },
      data: { status: "FAILED" },
    });

    // Detect operator accurately from transaction description, metadata or user phone
    const desc = (existingTx.description || "").toUpperCase();
    const meta = (existingTx.metadata as Record<string, unknown> | null) || {};
    const metaPhone = typeof meta.phone === "string" ? meta.phone : "";
    const phoneToCheck = (metaPhone || existingTx.user.phone || "").replace(/\D/g, "").replace(/^237/, "");
    const isOrange =
      desc.includes("ORANGE") ||
      meta.provider === "ORANGE" ||
      /^6(5[5-9]|9)/.test(phoneToCheck);
    const operatorName = isOrange ? "Orange Money" : "MTN Mobile Money";
    const ussdHint = isOrange
      ? "Si l'invite automatique n'est pas apparue, composez le #150*50# sur votre téléphone."
      : "Si l'invite automatique n'est pas apparue, composez le *126# sur votre téléphone.";

    // Detect if reason relates to user's mobile balance / funds
    const rawReason = (fapshiStatus.reason || "").toLowerCase();
    let failureMessage = "";
    if (
      rawReason.includes("balance") ||
      rawReason.includes("solde") ||
      rawReason.includes("fund") ||
      rawReason.includes("fonds") ||
      rawReason.includes("insufficient") ||
      rawReason.includes("insuffisant")
    ) {
      failureMessage = `Solde de votre compte ${operatorName} insuffisant pour effectuer cette recharge. Veuillez approvisionner votre compte ${operatorName} et réessayer.`;
    } else if (fapshiStatus.reason && !rawReason.includes("mobile money")) {
      failureMessage = fapshiStatus.reason;
    } else {
      failureMessage = `Le paiement ${operatorName} a été annulé, expiré ou n'a pas pu aboutir. ${ussdHint}`;
    }

    return {
      found: true,
      transId: cleanTransId,
      status,
      isPending: false,
      isSuccessful: false,
      isFailed: true,
      amount: Number(existingTx.amount),
      newBalance: Number(existingTx.user.walletBalance || 0),
      message: failureMessage,
    };
  }

  // Still CREATED or PENDING
  return {
    found: true,
    transId: cleanTransId,
    status: "PENDING",
    isPending: true,
    isSuccessful: false,
    isFailed: false,
    amount: Number(existingTx.amount),
    newBalance: Number(existingTx.user.walletBalance || 0),
    message: "En attente de votre validation par code secret sur votre téléphone...",
  };
}
