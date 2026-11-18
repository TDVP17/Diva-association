import { prisma } from "@/lib/prisma";
import { getNextDueDate, getContributionTotal } from "@/lib/tontine-engine";
import { debitWalletTx, InsufficientWalletBalanceError } from "@/lib/wallet-ledger";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import { sendEmailSafe } from "@/lib/email/resend";
import { renderBrandedEmailHtml } from "@/lib/email/template";
import { formatXAF } from "@/lib/format-currency";

/**
 * Checks if the current instant is Saturday at or after 08:00 Cameroon time (UTC+1 / Africa/Douala).
 * Callers can pass `force: true` to run immediately (e.g. admin manual trigger or scheduled Saturday 08:00 cron).
 */
export function isSaturdayEightAmCameroon(now: Date = new Date()): boolean {
  // Cameroon is permanently UTC+1 (no DST)
  const cmr = new Date(now.getTime() + 60 * 60 * 1000);
  const dayOfWeek = cmr.getUTCDay(); // 6 = Saturday
  const hour = cmr.getUTCHours();
  return dayOfWeek === 6 && hour >= 8;
}

export interface AutoWalletSweepResult {
  checkedSessions: number;
  paidSlotsCount: number;
  totalDebitedXAF: number;
  skippedInsufficientCount: number;
  paidDetails: Array<{
    userId: string;
    userName: string;
    sessionTitle: string;
    beneficiaryName: string;
    amount: number;
  }>;
}

/**
 * Automatically pays unpaid current-cycle contributions for any member who has sufficient
 * balance in their main DIVA Wallet (0% telecom fees), then notifies them via in-app & email.
 */
export async function runAutoWalletContributionsSweep(options?: {
  now?: Date;
  force?: boolean;
}): Promise<AutoWalletSweepResult> {
  const now = options?.now ?? new Date();

  const activeSessions = await prisma.tontineSession.findMany({
    where: {
      status: "ACTIVE",
      isPaused: false,
    },
    include: {
      memberships: {
        where: { status: "APPROVED" },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              walletBalance: true,
              preferredLang: true,
              isBanned: true,
            },
          },
          slots: {
            orderBy: { officialPosition: "asc" },
          },
        },
      },
    },
  });

  let paidSlotsCount = 0;
  let totalDebitedXAF = 0;
  let skippedInsufficientCount = 0;
  const paidDetails: AutoWalletSweepResult["paidDetails"] = [];

  for (const sess of activeSessions) {
    const dueDate = getNextDueDate(sess.type, now);
    const { amount, fee, total } = getContributionTotal({
      amount: Number(sess.amount),
      fee: Number(sess.fee),
    });
    const sessionTitle = sess.title || sess.type;

    const allSlotIds = sess.memberships.flatMap((m) => m.slots.map((s) => s.id));
    if (allSlotIds.length === 0) continue;

    const existingPaid = await prisma.contribution.findMany({
      where: {
        membershipSlotId: { in: allSlotIds },
        dueDate,
        status: "PAID",
      },
      select: { membershipSlotId: true },
    });
    const paidSet = new Set(existingPaid.map((c) => c.membershipSlotId));

    for (const membership of sess.memberships) {
      const user = membership.user;
      if (user.isBanned) continue;

      const unpaidSlots = membership.slots.filter((s) => !paidSet.has(s.id));
      if (unpaidSlots.length === 0) continue;

      const paidNamesForUser: string[] = [];
      let totalUserPaidThisSession = 0;
      let lastBalanceAfter = Number(user.walletBalance || 0);

      for (const slot of unpaidSlots) {
        // Re-check live balance before each slot
        const freshUser = await prisma.user.findUnique({
          where: { id: user.id },
          select: { walletBalance: true },
        });
        const available = Number(freshUser?.walletBalance || 0);
        if (available < total) {
          skippedInsufficientCount += 1;
          continue;
        }

        try {
          const ledger = await prisma.$transaction(async (tx) => {
            const debit = await debitWalletTx(tx, {
              userId: user.id,
              amount: total,
              fee: 0,
              type: "CONTRIBUTION",
              description: `Prélèvement automatique Portefeuille · ${sessionTitle} (${slot.beneficiaryName})`,
              metadata: {
                tontineSessionId: sess.id,
                membershipSlotId: slot.id,
                dueDate: dueDate.toISOString(),
                autoDebit: true,
              },
            });

            await tx.contribution.upsert({
              where: {
                membershipSlotId_dueDate: {
                  membershipSlotId: slot.id,
                  dueDate,
                },
              },
              create: {
                membershipSlotId: slot.id,
                dueDate,
                amountPaid: amount,
                feePaid: fee,
                finePaid: 0,
                status: "PAID",
                paidAt: now,
                payerPhone: "DIVA_WALLET_AUTO",
                providerFeeAmount: 0,
                providerShareAmount: 0,
                presidentFeeShareAmount: 0,
                failureReason: null,
              },
              update: {
                amountPaid: amount,
                feePaid: fee,
                finePaid: 0,
                status: "PAID",
                paidAt: now,
                payerPhone: "DIVA_WALLET_AUTO",
                providerFeeAmount: 0,
                providerShareAmount: 0,
                presidentFeeShareAmount: 0,
                failureReason: null,
              },
            });

            return debit;
          });

          paidSlotsCount += 1;
          totalDebitedXAF += total;
          totalUserPaidThisSession += total;
          lastBalanceAfter = ledger.balanceAfter;
          paidNamesForUser.push(slot.beneficiaryName);
          paidDetails.push({
            userId: user.id,
            userName: user.name,
            sessionTitle,
            beneficiaryName: slot.beneficiaryName,
            amount: total,
          });
        } catch (err) {
          if (err instanceof InsufficientWalletBalanceError) {
            skippedInsufficientCount += 1;
          } else {
            console.error("[auto-wallet-contribution] slot debit error:", err);
          }
        }
      }

      if (paidNamesForUser.length > 0) {
        const lang = user.preferredLang === "en" ? "en" : "fr";
        const namesList = paidNamesForUser.join(", ");

        await scheduleInAppNotifications({
          tontineSessionId: sess.id,
          type: "PAYMENT_SUCCESS",
          recipients: [
            {
              userId: user.id,
              message:
                lang === "fr"
                  ? `Cotisation automatique effectuée depuis votre compte principal (Portefeuille DIVA) : ${namesList} (${sessionTitle}) — Montant prélevé : ${formatXAF(totalUserPaidThisSession)}. Nouveau solde : ${formatXAF(lastBalanceAfter)}.`
                  : `Automatic contribution paid from your main DIVA Wallet: ${namesList} (${sessionTitle}) — Amount: ${formatXAF(totalUserPaidThisSession)}. New balance: ${formatXAF(lastBalanceAfter)}.`,
              actionUrl: `/sessions/${sess.id}`,
            },
          ],
        }).catch(() => {});

        if (user.email) {
          const html = renderBrandedEmailHtml({
            title:
              lang === "fr"
                ? "Cotisation automatique effectuée ✅"
                : "Automatic Contribution Completed ✅",
            bodyText:
              lang === "fr"
                ? `Bonjour ${user.name},\n\nVotre cotisation pour ${namesList} dans « ${sessionTitle} » a été prélevée automatiquement depuis votre compte principal (Portefeuille DIVA Asso) afin d'éviter tout retard.\n\n• Montant prélevé : ${formatXAF(totalUserPaidThisSession)} (0 % frais opérateur)\n• Nouveau solde portefeuille : ${formatXAF(lastBalanceAfter)}\n\nVos noms sont désormais cochés !`
                : `Hello ${user.name},\n\nYour contribution for ${namesList} in "${sessionTitle}" was automatically paid from your main DIVA Asso Wallet.\n\n• Amount debited: ${formatXAF(totalUserPaidThisSession)} (0% operator fee)\n• New wallet balance: ${formatXAF(lastBalanceAfter)}`,
            actionUrl: `/sessions/${sess.id}`,
            actionLabel: lang === "fr" ? "Voir ma cotisation" : "View My Cotisation",
            lang,
          });
          await sendEmailSafe(
            user.email,
            lang === "fr"
              ? `DIVA Asso — Cotisation automatique effectuée (${formatXAF(totalUserPaidThisSession)})`
              : `DIVA Asso — Automatic Contribution Paid (${formatXAF(totalUserPaidThisSession)})`,
            html,
          ).catch(() => {});
        }
      }

      // Si des noms n'ont pas pu être cotisés ET que le solde principal est > 0 (jamais si solde === 0)
      const stillUnpaidSlots = unpaidSlots.filter(
        (s) => !paidNamesForUser.includes(s.beneficiaryName),
      );
      if (stillUnpaidSlots.length > 0) {
        const freshAfter = await prisma.user.findUnique({
          where: { id: user.id },
          select: { walletBalance: true },
        });
        const remainingBal = Number(freshAfter?.walletBalance || 0);
        const neededAmount = stillUnpaidSlots.length * total;

        if (remainingBal > 0 && remainingBal < neededAmount) {
          const lang = user.preferredLang === "en" ? "en" : "fr";
          const unpaidNamesList = stillUnpaidSlots.map((s) => s.beneficiaryName).join(", ");
          await scheduleInAppNotifications({
            tontineSessionId: sess.id,
            type: "CONTRIBUTION_REMINDER",
            recipients: [
              {
                userId: user.id,
                message:
                  lang === "fr"
                    ? `⚠️ Solde principal insuffisant (${formatXAF(remainingBal)}) pour cotiser automatiquement vos noms restants (${unpaidNamesList}) dans « ${sessionTitle} » (${formatXAF(neededAmount)} requis). Veuillez recharger votre portefeuille ou cotiser directement.`
                    : `⚠️ Insufficient main balance (${formatXAF(remainingBal)}) to auto-pay your remaining slots (${unpaidNamesList}) in "${sessionTitle}" (${formatXAF(neededAmount)} required). Please top up your wallet or pay directly.`,
                actionUrl: `/wallet`,
              },
            ],
          }).catch(() => {});

          if (user.email) {
            const html = renderBrandedEmailHtml({
              title:
                lang === "fr"
                  ? "Solde principal insuffisant pour votre cotisation ⚠️"
                  : "Insufficient Wallet Balance for Your Contribution ⚠️",
              bodyText:
                lang === "fr"
                  ? `Bonjour ${user.name},\n\nVotre solde principal (Portefeuille DIVA Asso : ${formatXAF(remainingBal)}) est insuffisant pour cotiser automatiquement vos noms restants (${unpaidNamesList}) dans « ${sessionTitle} ».\n\n• Montant requis : ${formatXAF(neededAmount)}\n• Solde actuel : ${formatXAF(remainingBal)}\n\nVeuillez recharger votre portefeuille ou payer directement par Mobile Money afin d'éviter toute amende.`
                  : `Hello ${user.name},\n\nYour main wallet balance (${formatXAF(remainingBal)}) is insufficient to automatically pay your remaining slots (${unpaidNamesList}) in "${sessionTitle}" (${formatXAF(neededAmount)} required).`,
              actionUrl: `/wallet`,
              actionLabel: lang === "fr" ? "Recharger mon portefeuille" : "Top Up Wallet",
              lang,
            });
            await sendEmailSafe(
              user.email,
              lang === "fr"
                ? `DIVA Asso — Solde principal insuffisant pour cotiser (${sessionTitle})`
                : `DIVA Asso — Insufficient Wallet Balance (${sessionTitle})`,
              html,
            ).catch(() => {});
          }
        }
      }
    }
  }

  return {
    checkedSessions: activeSessions.length,
    paidSlotsCount,
    totalDebitedXAF,
    skippedInsufficientCount,
    paidDetails,
  };
}

