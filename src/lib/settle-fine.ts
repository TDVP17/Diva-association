import type { Fine, Membership, MembershipSlot, TontineSession, User } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { sendEmailSafe } from "@/lib/email/resend";
import { renderBrandedEmailHtml } from "@/lib/email/template";
import { translate } from "@/lib/i18n/translations";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import { formatXAF } from "@/lib/format-currency";
import { creditWalletTx } from "@/lib/wallet-ledger";
import { calculatePenaltySplit } from "@/lib/private-tontine-finance";

import { TONTINE_TYPE_LABELS as TONTINE_LABELS } from "@/lib/tontine-labels";

type FineWithSlot = Fine & {
  membershipSlot: MembershipSlot & {
    membership: Membership & { user: User; tontineSession: TontineSession };
  };
};

/**
 * Distribue une amende de retard PAYÉE selon les règles :
 * - Cotisation publique : 50 % au bénéficiaire retardé (crédité sur son Portefeuille DIVA Asso).
 * - Cotisation privée : pourcentage configuré par le créateur (0 % à 100 %) au bénéficiaire retardé,
 *   et le solde (100 % - pct) versé au portefeuille du créateur.
 * Protégé par idempotence (`fine.penaltyDistributedAt`) : jamais distribué avant paiement, jamais distribué deux fois.
 */
export async function creditLateBeneficiaryWithHalfFine(params: {
  tontineSessionId: string;
  dueDate: Date;
  fineAmount: number;
  finePayerName: string;
  sessionTitle: string;
  fineId?: string;
}): Promise<number> {
  if (params.fineAmount <= 0) return 0;

  try {
    // 0. Idempotence & garantie "uniquement après paiement effectif" si fineId est fourni
    if (params.fineId) {
      const claim = await prisma.fine.updateMany({
        where: {
          id: params.fineId,
          status: "PAID",
          penaltyDistributedAt: null,
        },
        data: { penaltyDistributedAt: new Date() },
      });
      if (claim.count === 0) {
        return 0; // Déjà distribué ou pas encore payé
      }
    }

    const sessionRow = await prisma.tontineSession.findUnique({
      where: { id: params.tontineSessionId },
      select: {
        isPrivate: true,
        creatorId: true,
        privatePenaltyBeneficiaryPct: true,
      },
    });

    const beneficiaryPct = sessionRow?.isPrivate
      ? (sessionRow.privatePenaltyBeneficiaryPct ?? 100)
      : 50;

    const split = calculatePenaltySplit(params.fineAmount, beneficiaryPct);

    // 1. Chercher le payout prévu ou déjà créé pour cette échéance (dueDate)
    const cyclePayout = await prisma.payout.findUnique({
      where: {
        tontineSessionId_dueDate: {
          tontineSessionId: params.tontineSessionId,
          dueDate: params.dueDate,
        },
      },
      include: {
        membershipSlot: {
          include: {
            membership: {
              include: { user: true },
            },
          },
        },
      },
    });

    let targetUser = cyclePayout?.membershipSlot?.membership?.user;

    // 2. Si pas de payout pour cette date, chercher le membre dont c'est le tour
    if (!targetUser) {
      const designatedSlot = await prisma.membershipSlot.findFirst({
        where: {
          membership: { tontineSessionId: params.tontineSessionId },
          officialPosition: { not: null },
          payouts: { none: {} },
        },
        include: {
          membership: {
            include: { user: true },
          },
        },
        orderBy: { officialPosition: "asc" },
      });
      targetUser = designatedSlot?.membership?.user;
    }

    // 3. Créditer atomiquement le bénéficiaire retardé (et le créateur pour le solde en cotisation privée)
    await prisma.$transaction(async (tx) => {
      if (targetUser && split.toDelayedBeneficiary > 0) {
        await creditWalletTx(tx, {
          userId: targetUser.id,
          amount: split.toDelayedBeneficiary,
          fee: 0,
          type: "PAYOUT",
          description: `Part ${split.beneficiaryPercentage}% amende de retard (+${formatXAF(split.toDelayedBeneficiary)}) suite au retard de ${params.finePayerName} · ${params.sessionTitle}`,
          metadata: {
            fineId: params.fineId ?? null,
            tontineSessionId: params.tontineSessionId,
            role: "delayed_beneficiary",
          },
        });
      }

      if (
        sessionRow?.isPrivate &&
        sessionRow.creatorId &&
        split.toRemainingRecipient > 0
      ) {
        await creditWalletTx(tx, {
          userId: sessionRow.creatorId,
          amount: split.toRemainingRecipient,
          fee: 0,
          type: "PAYOUT",
          description: `Part gestionnaire (${100 - split.beneficiaryPercentage}%) amende payée par ${params.finePayerName} · ${params.sessionTitle}`,
          metadata: {
            fineId: params.fineId ?? null,
            tontineSessionId: params.tontineSessionId,
            role: "private_creator_penalty_share",
          },
        });
      }
    });

    // 4. Notifier les bénéficiaires APRÈS crédit réussi
    if (targetUser && split.toDelayedBeneficiary > 0) {
      const benLang = targetUser.preferredLang === "en" ? "en" : "fr";
      const notifMsg =
        benLang === "fr"
          ? `Vous avez reçu ${formatXAF(split.toDelayedBeneficiary)} (${split.beneficiaryPercentage}% de l'amende de retard payée) crédités dans votre Portefeuille DIVA Asso suite au retard de cotisation dans ${params.sessionTitle}.`
          : `You received ${formatXAF(split.toDelayedBeneficiary)} (${split.beneficiaryPercentage}% late fine share) credited to your DIVA Asso Wallet for ${params.sessionTitle}.`;

      await scheduleInAppNotifications({
        tontineSessionId: params.tontineSessionId,
        type: "PAYMENT_SUCCESS",
        recipients: [
          {
            userId: targetUser.id,
            message: notifMsg,
            actionUrl: "/wallet",
          },
        ],
      }).catch(() => {});
    }

    if (
      sessionRow?.isPrivate &&
      sessionRow.creatorId &&
      split.toRemainingRecipient > 0
    ) {
      await scheduleInAppNotifications({
        tontineSessionId: params.tontineSessionId,
        type: "PAYMENT_SUCCESS",
        recipients: [
          {
            userId: sessionRow.creatorId,
            message: `Vous avez reçu ${formatXAF(split.toRemainingRecipient)} (${100 - split.beneficiaryPercentage}% de l'amende payée par ${params.finePayerName}) dans votre Portefeuille DIVA Asso pour « ${params.sessionTitle} ».`,
            actionUrl: "/wallet",
          },
        ],
      }).catch(() => {});
    }

    return split.toDelayedBeneficiary;
  } catch (err) {
    console.error("[creditLateBeneficiaryWithHalfFine] Error crediting fine split:", err);
    return 0;
  }
}

/**
 * Marks a standalone Fine payment as settled and notifies the member —
 * the Fine equivalent of settleContribution(), for fines paid on their own
 * via /fines rather than bundled into a slot's current-cycle contribution.
 */
export async function settleFine(fine: FineWithSlot): Promise<void> {
  await prisma.fine.update({ where: { id: fine.id }, data: { status: "PAID" } });

  const { user, tontineSession } = fine.membershipSlot.membership;
  const lang = user.preferredLang === "en" ? "en" : "fr";
  const sessionLabel = tontineSession.title || TONTINE_LABELS[tontineSession.type] || tontineSession.type;
  const amount = Number(fine.amount);

  // 50% de l'amende revient à la personne qui bouffe en retard (crédité sur son portefeuille DIVA Asso)
  await creditLateBeneficiaryWithHalfFine({
    tontineSessionId: tontineSession.id,
    dueDate: fine.dueDate,
    fineAmount: amount,
    finePayerName: user.name,
    sessionTitle: sessionLabel,
    fineId: fine.id,
  });

  const message = translate(lang, "finePaidMessage", {
    amount: formatXAF(amount),
    session: sessionLabel,
  });

  const subject = translate(lang, "finePaidEmailSubject");
  const emailHtml = renderBrandedEmailHtml({
    title: subject,
    bodyText: message,
    actionUrl: "/fines",
    actionLabel: lang === "en" ? "View Fines" : "Voir mes amendes",
    lang,
  });

  await sendEmailSafe(user.email, subject, emailHtml);

  await scheduleInAppNotifications({
    tontineSessionId: tontineSession.id,
    type: "PAYMENT_SUCCESS",
    recipients: [
      {
        userId: user.id,
        message,
        messageKey: "paymentSuccessNotifMessage",
        messageVars: { amount: formatXAF(amount), session: sessionLabel },
        actionUrl: "/fines",
      },
    ],
  });
}
