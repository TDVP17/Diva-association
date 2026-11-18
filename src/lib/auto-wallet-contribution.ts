import { prisma } from "@/lib/prisma";
import { getNextDueDate, getContributionTotal } from "@/lib/tontine-engine";
import { debitWalletTx, InsufficientWalletBalanceError } from "@/lib/wallet-ledger";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import { sendEmailSafe } from "@/lib/email/resend";
import { renderBrandedEmailHtml } from "@/lib/email/template";
import { formatXAF } from "@/lib/format-currency";

const CMR_OFFSET_MS = 60 * 60 * 1000; // Africa/Douala UTC+1 (no DST)

/**
 * Checks if `now` is Cameroon time >= 08:00 on the day BEFORE `dueDate` (J-1).
 * Works for ANY cadence (every Sunday -> Saturday 08:00, every Saturday -> Friday 08:00, Monthly 28 -> 27th 08:00, etc.).
 */
export function isOneDayBeforeDueDateCameroon(dueDate: Date, now: Date = new Date()): boolean {
  const cmrNow = new Date(now.getTime() + CMR_OFFSET_MS);
  const cmrDue = new Date(dueDate.getTime() + CMR_OFFSET_MS);

  const nowDayUtc = Date.UTC(cmrNow.getUTCFullYear(), cmrNow.getUTCMonth(), cmrNow.getUTCDate());
  const dueDayUtc = Date.UTC(cmrDue.getUTCFullYear(), cmrDue.getUTCMonth(), cmrDue.getUTCDate());
  const diffDays = Math.round((dueDayUtc - nowDayUtc) / (24 * 60 * 60 * 1000));

  return diffDays === 1 && cmrNow.getUTCHours() >= 8;
}

/**
 * Backwards-compatible helper kept for tests/references: Saturday >= 08:00 Cameroon time.
 */
export function isSaturdayEightAmCameroon(now: Date = new Date()): boolean {
  const cmr = new Date(now.getTime() + CMR_OFFSET_MS);
  return cmr.getUTCDay() === 6 && cmr.getUTCHours() >= 8;
}

export interface AutoWalletSweepResult {
  checkedSessions: number;
  eligibleSessionsJMinus1: number;
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
 * Automatically pays unpaid current-cycle contributions 1 day before the cotisation due date (J-1 at 08:00 CMR):
 * - ALL-OR-NOTHING per member per session:
 *   - If walletBalance >= totalNeeded for ALL unpaid slots -> debits full amount & marks ALL slots PAID, notifies member.
 *   - If 0 < walletBalance < totalNeeded -> pays ZERO slots (none!) and notifies member (in-app + email).
 *   - If walletBalance === 0 -> pays ZERO slots and sends NO notification.
 */
export async function runAutoWalletContributionsSweep(options?: {
  now?: Date;
  force?: boolean;
}): Promise<AutoWalletSweepResult> {
  const now = options?.now ?? new Date();
  const force = Boolean(options?.force);

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

  let eligibleSessionsJMinus1 = 0;
  let paidSlotsCount = 0;
  let totalDebitedXAF = 0;
  let skippedInsufficientCount = 0;
  const paidDetails: AutoWalletSweepResult["paidDetails"] = [];

  for (const sess of activeSessions) {
    // Check if private cotisation opted out of auto wallet debit
    const privateConfig = sess.privateConfig as { selectedActions?: string[] } | null;
    if (
      sess.isPrivate &&
      Array.isArray(privateConfig?.selectedActions) &&
      !privateConfig.selectedActions.includes("allow_wallet_auto")
    ) {
      continue;
    }

    const dueDate = getNextDueDate(sess.type, now);
    if (!force && !isOneDayBeforeDueDateCameroon(dueDate, now)) {
      continue;
    }

    eligibleSessionsJMinus1 += 1;

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

      const totalNeeded = unpaidSlots.length * total;
      const freshUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { walletBalance: true },
      });
      const available = Number(freshUser?.walletBalance || 0);
      const lang = user.preferredLang === "en" ? "en" : "fr";
      const allNamesList = unpaidSlots.map((s) => s.beneficiaryName).join(", ");

      // Rule 1: Balance is 0 -> do NOTHING and send NO notification
      if (available <= 0) {
        skippedInsufficientCount += unpaidSlots.length;
        continue;
      }

      // Rule 2: Balance > 0 but insufficient to cover ALL unpaid names -> ALL-OR-NOTHING (pay 0 names) + notify!
      if (available < totalNeeded) {
        skippedInsufficientCount += unpaidSlots.length;

        await scheduleInAppNotifications({
          tontineSessionId: sess.id,
          type: "CONTRIBUTION_REMINDER",
          recipients: [
            {
              userId: user.id,
              message:
                lang === "fr"
                  ? `Solde principal insuffisant (${formatXAF(available)}) pour cotiser automatiquement l'ensemble de vos noms (${allNamesList}) dans « ${sessionTitle} » (${formatXAF(totalNeeded)} requis). Aucun nom n'a été prélevé. Rechargez votre Portefeuille DIVA Asso ou cotisez directement.`
                  : `Insufficient main balance (${formatXAF(available)}) to auto-pay all your slots (${allNamesList}) in "${sessionTitle}" (${formatXAF(totalNeeded)} required). No slot was debited.`,
              actionUrl: "/wallet",
            },
          ],
        }).catch(() => {});

        if (user.email) {
          const subject =
            lang === "fr"
              ? `DIVA Asso — Solde insuffisant pour votre cotisation (${sessionTitle})`
              : `DIVA Asso — Insufficient Wallet Balance (${sessionTitle})`;
          const bodyText =
            lang === "fr"
              ? `Bonjour ${user.name},\n\nVotre cotisation dans « ${sessionTitle} » a lieu demain. Votre solde actuel dans le Portefeuille DIVA Asso (${formatXAF(available)}) est insuffisant pour régler l'ensemble de vos noms (${allNamesList}).\n\n• Montant total requis : ${formatXAF(totalNeeded)}\n• Solde disponible : ${formatXAF(available)}\n\nAucun nom n'a été cotisé automatiquement. Veuillez recharger votre Portefeuille DIVA Asso ou régler directement par Mobile Money afin d'éviter toute amende.`
              : `Hello ${user.name},\n\nYour contribution in "${sessionTitle}" is due tomorrow. Your current DIVA Asso Wallet balance (${formatXAF(available)}) is insufficient to cover all your slots (${allNamesList}, total required: ${formatXAF(totalNeeded)}). No slot was debited. Please top up your wallet or pay directly.`;
          const html = renderBrandedEmailHtml({
            title: subject,
            bodyText,
            actionUrl: "/wallet",
            actionLabel: lang === "fr" ? "Recharger mon portefeuille" : "Top Up Wallet",
            lang,
          });
          await sendEmailSafe(user.email, subject, html).catch(() => {});
        }
        continue;
      }

      // Rule 3: Balance >= totalNeeded -> atomically debit ALL names in ONE transaction & mark ALL PAID!
      try {
        const ledger = await prisma.$transaction(async (tx) => {
          const debit = await debitWalletTx(tx, {
            userId: user.id,
            amount: totalNeeded,
            fee: 0,
            type: "CONTRIBUTION",
            description: `Cotisation automatique Portefeuille J-1 · ${sessionTitle} (${allNamesList})`,
            metadata: {
              tontineSessionId: sess.id,
              slotIds: unpaidSlots.map((s) => s.id),
              dueDate: dueDate.toISOString(),
              autoDebit: true,
            },
          });

          for (const slot of unpaidSlots) {
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
          }

          return debit;
        });

        paidSlotsCount += unpaidSlots.length;
        totalDebitedXAF += totalNeeded;
        for (const slot of unpaidSlots) {
          paidDetails.push({
            userId: user.id,
            userName: user.name,
            sessionTitle,
            beneficiaryName: slot.beneficiaryName,
            amount: total,
          });
        }

        await scheduleInAppNotifications({
          tontineSessionId: sess.id,
          type: "PAYMENT_SUCCESS",
          recipients: [
            {
              userId: user.id,
              message:
                lang === "fr"
                  ? `Cotisation automatique effectuée depuis votre Portefeuille DIVA Asso (0 % frais) : ${allNamesList} (${sessionTitle}) — Montant prélevé : ${formatXAF(totalNeeded)}. Nouveau solde : ${formatXAF(ledger.balanceAfter)}.`
                  : `Automatic contribution paid from your DIVA Asso Wallet (0% fee): ${allNamesList} (${sessionTitle}) — Amount: ${formatXAF(totalNeeded)}. New balance: ${formatXAF(ledger.balanceAfter)}.`,
              actionUrl: `/sessions/${sess.id}`,
            },
          ],
        }).catch(() => {});

        if (user.email) {
          const subject =
            lang === "fr"
              ? `DIVA Asso — Cotisation automatique effectuée (${formatXAF(totalNeeded)})`
              : `DIVA Asso — Automatic Contribution Paid (${formatXAF(totalNeeded)})`;
          const bodyText =
            lang === "fr"
              ? `Bonjour ${user.name},\n\nVotre cotisation pour ${allNamesList} dans « ${sessionTitle} » a été prélevée automatiquement depuis votre Portefeuille DIVA Asso (la veille de l'échéance) sans aucun frais Orange ou MTN.\n\n• Montant prélevé : ${formatXAF(totalNeeded)} (0 % frais opérateur)\n• Nouveau solde portefeuille : ${formatXAF(ledger.balanceAfter)}\n\nTous vos noms sont désormais cochés.`
              : `Hello ${user.name},\n\nYour contribution for ${allNamesList} in "${sessionTitle}" was automatically paid from your DIVA Asso Wallet with 0% operator fees.\n\n• Amount debited: ${formatXAF(totalNeeded)}\n• New wallet balance: ${formatXAF(ledger.balanceAfter)}`;
          const html = renderBrandedEmailHtml({
            title: subject,
            bodyText,
            actionUrl: `/sessions/${sess.id}`,
            actionLabel: lang === "fr" ? "Voir ma cotisation" : "View My Cotisation",
            lang,
          });
          await sendEmailSafe(user.email, subject, html).catch(() => {});
        }
      } catch (err) {
        if (err instanceof InsufficientWalletBalanceError) {
          skippedInsufficientCount += unpaidSlots.length;
        } else {
          console.error("[auto-wallet-contribution] batch debit error:", err);
        }
      }
    }
  }

  return {
    checkedSessions: activeSessions.length,
    eligibleSessionsJMinus1,
    paidSlotsCount,
    totalDebitedXAF,
    skippedInsufficientCount,
    paidDetails,
  };
}
