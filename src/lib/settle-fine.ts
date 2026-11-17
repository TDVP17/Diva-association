import type { Fine, Membership, MembershipSlot, TontineSession, User } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { sendEmailSafe } from "@/lib/email/resend";
import { renderBrandedEmailHtml } from "@/lib/email/template";
import { translate } from "@/lib/i18n/translations";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import { formatXAF } from "@/lib/format-currency";

import { TONTINE_TYPE_LABELS as TONTINE_LABELS } from "@/lib/tontine-labels";

type FineWithSlot = Fine & {
  membershipSlot: MembershipSlot & {
    membership: Membership & { user: User; tontineSession: TontineSession };
  };
};

/**
 * 50% de l'amende revient à la personne qui a bouffé (ou doit bouffer) en retard pour ce cycle.
 * Entrée directement dans son solde portefeuille virtuel DIVA Asso.
 */
export async function creditLateBeneficiaryWithHalfFine(params: {
  tontineSessionId: string;
  dueDate: Date;
  fineAmount: number;
  finePayerName: string;
  sessionTitle: string;
}): Promise<number> {
  const half = Math.round(params.fineAmount * 0.5);
  if (half <= 0) return 0;

  try {
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

    if (!targetUser) {
      console.warn("[creditLateBeneficiaryWithHalfFine] Aucun bénéficiaire désigné trouvé pour le cycle", params.dueDate);
      return 0;
    }

    // 3. Créditer le portefeuille DIVA Asso du bénéficiaire retardé
    await prisma.$transaction([
      prisma.user.update({
        where: { id: targetUser.id },
        data: {
          walletBalance: { increment: half },
        },
      }),
      prisma.walletTransaction.create({
        data: {
          userId: targetUser.id,
          amount: half,
          fee: 0,
          type: "PAYOUT",
          description: `Part 50% amende de retard (+${formatXAF(half)}) versée suite au retard de ${params.finePayerName} · ${params.sessionTitle}`,
        },
      }),
    ]);

    // 4. Notifier le bénéficiaire
    const benLang = targetUser.preferredLang === "en" ? "en" : "fr";
    const notifMsg =
      benLang === "fr"
        ? `🎉 Bonne nouvelle ! Vous avez reçu ${formatXAF(half)} (50% de l'amende de retard) crédités directement sur votre portefeuille DIVA Asso suite au retard de cotisation dans ${params.sessionTitle}.`
        : `🎉 You received ${formatXAF(half)} (50% late fine share) credited directly to your DIVA Asso wallet due to a late contribution in ${params.sessionTitle}.`;

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
    });

    return half;
  } catch (err) {
    console.error("[creditLateBeneficiaryWithHalfFine] Error crediting half fine:", err);
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
