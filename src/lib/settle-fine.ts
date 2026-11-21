import type { Fine, Membership, MembershipSlot, TontineSession, User } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { sendEmailSafe } from "@/lib/email/resend";
import { renderBrandedEmailHtml } from "@/lib/email/template";
import { translate } from "@/lib/i18n/translations";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import { formatXAF } from "@/lib/format-currency";
import { creditWalletTx } from "@/lib/wallet-ledger";
import { calculatePenaltySplit } from "@/lib/private-tontine-finance";
import { getCycleDateForRound, toDueDateKey } from "@/lib/tontine-engine";

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
        id: true,
        type: true,
        startDate: true,
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
    const normalizedDueDate = toDueDateKey(new Date(params.dueDate));
    const cyclePayout = await prisma.payout.findFirst({
      where: {
        tontineSessionId: params.tontineSessionId,
        dueDate: {
          gte: new Date(normalizedDueDate.getTime() - 12 * 3600 * 1000),
          lte: new Date(normalizedDueDate.getTime() + 36 * 3600 * 1000),
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

    // 2. Si pas de payout pour cette date, calculer le round exact correspondant à dueDate
    if (!targetUser && sessionRow?.startDate && sessionRow.type) {
      for (let r = 1; r <= 100; r++) {
        try {
          const rDate = getCycleDateForRound(sessionRow.type, sessionRow.startDate, r);
          if (toDueDateKey(rDate).getTime() === normalizedDueDate.getTime()) {
            const slotForRound = await prisma.membershipSlot.findFirst({
              where: {
                membership: { tontineSessionId: params.tontineSessionId },
                officialPosition: r,
              },
              include: {
                membership: {
                  include: { user: true },
                },
              },
            });
            if (slotForRound?.membership?.user) {
              targetUser = slotForRound.membership.user;
            }
            break;
          }
        } catch {
          break;
        }
      }
    }

    // 3. Fallback : premier slot en attente de payout ordonné par position officielle
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

    const dueDateObj = new Date(params.dueDate);
    const dueDateFormattedFr = new Intl.DateTimeFormat("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Africa/Douala",
    }).format(dueDateObj);
    const dueDateFormattedEn = new Intl.DateTimeFormat("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Africa/Douala",
    }).format(dueDateObj);

    // 4. Créditer atomiquement le bénéficiaire retardé (et le créateur pour le solde en cotisation privée)
    await prisma.$transaction(async (tx) => {
      if (targetUser && split.toDelayedBeneficiary > 0) {
        await creditWalletTx(tx, {
          userId: targetUser.id,
          amount: split.toDelayedBeneficiary,
          fee: 0,
          type: "PAYOUT",
          description: `Indemnité de retard (+${formatXAF(split.toDelayedBeneficiary)}) : ${split.beneficiaryPercentage}% amende payée par ${params.finePayerName} pour votre tour du ${dueDateFormattedFr} · ${params.sessionTitle}`,
          metadata: {
            fineId: params.fineId ?? null,
            tontineSessionId: params.tontineSessionId,
            role: "delayed_beneficiary",
            dueDate: params.dueDate instanceof Date ? params.dueDate.toISOString() : params.dueDate,
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
          description: `Part gestionnaire (${100 - split.beneficiaryPercentage}%) amende payée par ${params.finePayerName} pour l'échéance du ${dueDateFormattedFr} · ${params.sessionTitle}`,
          metadata: {
            fineId: params.fineId ?? null,
            tontineSessionId: params.tontineSessionId,
            role: "private_creator_penalty_share",
            dueDate: params.dueDate instanceof Date ? params.dueDate.toISOString() : params.dueDate,
          },
        });
      }
    });

    // 5. Notifier les bénéficiaires APRÈS crédit réussi
    if (targetUser && split.toDelayedBeneficiary > 0) {
      const benLang = targetUser.preferredLang === "en" ? "en" : "fr";
      const dueDateLabel = benLang === "fr" ? dueDateFormattedFr : dueDateFormattedEn;
      const notifMsg =
        benLang === "fr"
          ? `🌿 Bonne nouvelle ! Vous avez reçu ${formatXAF(split.toDelayedBeneficiary)} (${split.beneficiaryPercentage}% d'amende de retard payée par ${params.finePayerName}) disponible sur votre Portefeuille DIVA Asso suite au retard sur votre tour de cotisation du ${dueDateLabel} (« ${params.sessionTitle} »).`
          : `🌿 Great news! You received ${formatXAF(split.toDelayedBeneficiary)} (${split.beneficiaryPercentage}% late fine compensation paid by ${params.finePayerName}) in your DIVA Asso Wallet for your cotisation turn on ${dueDateLabel} (« ${params.sessionTitle} »).`;

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

      if (targetUser.email) {
        const emailTitle =
          benLang === "fr"
            ? `🌿 Indemnité de retard de ${formatXAF(split.toDelayedBeneficiary)} reçue sur votre Portefeuille !`
            : `🌿 Late fine compensation of ${formatXAF(split.toDelayedBeneficiary)} credited to your Wallet!`;
        const emailHtml = renderBrandedEmailHtml({
          title: emailTitle,
          bodyText: notifMsg,
          actionUrl: "/wallet",
          actionLabel: benLang === "fr" ? "Voir mon portefeuille" : "View my wallet",
          recipientName: targetUser.name,
          lang: benLang,
        });
        await sendEmailSafe(targetUser.email, emailTitle, emailHtml).catch(() => {});
      }
    }

    if (
      sessionRow?.isPrivate &&
      sessionRow.creatorId &&
      split.toRemainingRecipient > 0
    ) {
      const creatorMsg = `Vous avez reçu ${formatXAF(split.toRemainingRecipient)} (${100 - split.beneficiaryPercentage}% de l'amende payée par ${params.finePayerName}) dans votre Portefeuille DIVA Asso pour « ${params.sessionTitle} ».`;
      await scheduleInAppNotifications({
        tontineSessionId: params.tontineSessionId,
        type: "PAYMENT_SUCCESS",
        recipients: [
          {
            userId: sessionRow.creatorId,
            message: creatorMsg,
            actionUrl: "/wallet",
          },
        ],
      }).catch(() => {});

      const creator = await prisma.user.findUnique({
        where: { id: sessionRow.creatorId },
        select: { email: true, name: true, preferredLang: true },
      });
      if (creator?.email) {
        const cLang = creator.preferredLang === "en" ? "en" : "fr";
        const cTitle =
          cLang === "fr"
            ? "Part gestionnaire d'amende reçue ! 🌿💰"
            : "Creator penalty share credited! 🌿💰";
        const emailHtml = renderBrandedEmailHtml({
          title: cTitle,
          bodyText: creatorMsg,
          actionUrl: "/wallet",
          actionLabel: cLang === "fr" ? "Consulter mon portefeuille" : "View my wallet",
          recipientName: creator.name,
          lang: cLang,
        });
        await sendEmailSafe(creator.email, cTitle, emailHtml).catch(() => {});
      }
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
