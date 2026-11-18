import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { computePayoutPreview } from "@/lib/payout-preview";
import { sendPayout, FapshiPayoutError } from "@/lib/fapshi-payout";
import { detectMobileMoneyProvider, fapshiMediumFor } from "@/lib/mobile-money-provider";
import { sendEmailSafe } from "@/lib/email/resend";
import { renderBrandedEmailHtml } from "@/lib/email/template";
import { payoutTurnMessage, payoutReleasedMessage } from "@/lib/whatsapp/templates";
import { scheduleInAppNotifications, scheduleNotifications } from "@/lib/notifications/dispatch";
import { getDesignatedSlot } from "@/lib/round-robin-lock";
import { getNextDueDate } from "@/lib/tontine-engine";
import { TONTINE_TYPE_LABELS } from "@/lib/tontine-labels";
import { logAudit } from "@/lib/audit";
import { formatXAF } from "@/lib/format-currency";
import { creditWalletTx } from "@/lib/wallet-ledger";
import { computeAccruedLoanPenalty, deductActiveLoansFromPayoutTx } from "@/lib/loans";

const bodySchema = z.object({
  payoutClaimId: z.string().min(1),
  channel: z.enum(["FAPSHI", "DIRECT", "WALLET"]).default("WALLET"),
  overrideUnpaid: z.boolean().optional(),
  selectedOperator: z.enum(["MTN", "ORANGE"]).optional(),
  selectedPhone: z.string().optional(),
  selectedAccountName: z.string().optional(),
});

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { payoutClaimId, channel } = parsed.data;

  const claim = await prisma.payout.findUnique({
    where: { id: payoutClaimId },
    include: {
      tontineSession: true,
      membershipSlot: { include: { membership: { include: { user: true } } } },
    },
  });
  if (!claim) {
    return NextResponse.json({ error: "Payout claim not found" }, { status: 404 });
  }
  if (claim.status !== "DETAILS_SUBMITTED") {
    return NextResponse.json({ error: "This payout has already been processed" }, { status: 409 });
  }

  const slot = claim.membershipSlot;
  const { user } = slot.membership;

  // Règle Diva : c'est uniquement lorsque tout le monde a cotisé (y compris le bénéficiaire) que la cagnotte peut être versée
  const allApprovedSlots = await prisma.membershipSlot.findMany({
    where: {
      membership: { tontineSessionId: claim.tontineSessionId, status: "APPROVED" },
    },
    select: { id: true, beneficiaryName: true },
  });

  const unpaidSlots = await prisma.membershipSlot.findMany({
    where: {
      id: { in: allApprovedSlots.map((s) => s.id) },
      contributions: {
        none: {
          dueDate: claim.dueDate,
          status: "PAID",
        },
      },
    },
    select: { beneficiaryName: true },
  });

  if (unpaidSlots.length > 0 && !parsed.data.overrideUnpaid) {
    const unpaidNames = unpaidSlots.map((s) => s.beneficiaryName).join(", ");
    return NextResponse.json(
      {
        error: `Impossible de verser la cagnotte : tous les membres doivent avoir cotisé avant le versement. Noms en attente (${unpaidSlots.length}) : ${unpaidNames}.`,
        unpaidCount: unpaidSlots.length,
        canOverride: true,
      },
      { status: 409 },
    );
  }

  // Never trust a client-echoed amount — recompute server-side right before sending money.
  const { pot, deducted, netPayout, toDeductFineIds, toDeductContributions } = await computePayoutPreview(
    claim.tontineSession,
    slot,
    claim.dueDate,
  );

  let targetPhone = claim.payoutPhone;
  let targetName = claim.payoutAccountName;

  if (parsed.data.selectedOperator === "ORANGE") {
    targetPhone = claim.payoutOrangePhone || claim.payoutPhone;
    targetName = claim.payoutOrangeName || claim.payoutAccountName;
  } else if (parsed.data.selectedOperator === "MTN") {
    targetPhone = claim.payoutMtnPhone || claim.payoutPhone;
    targetName = claim.payoutMtnName || claim.payoutAccountName;
  }
  if (parsed.data.selectedPhone) {
    targetPhone = parsed.data.selectedPhone;
  }
  if (parsed.data.selectedAccountName) {
    targetName = parsed.data.selectedAccountName;
  }

  const rawPhone = (targetPhone || "").replace(/\D/g, "");
  const normalizedPhone = rawPhone.startsWith("237") && rawPhone.length === 12 ? rawPhone.slice(3) : rawPhone;
  const provider = detectMobileMoneyProvider(normalizedPhone);
  const medium = provider ? fapshiMediumFor(provider) : undefined;
  const payoutName = (targetName || slot.beneficiaryName).trim();

  // Prélèvement à la source (Garantie Ultime Prêt d'Urgence - Pilier 2 Section 3.3)
  const openLoansPreview = await prisma.loan.findMany({
    where: { userId: user.id, status: { in: ["ACTIVE", "OVERDUE"] } },
  });
  const nowForLoans = new Date();
  const estimatedLoanDue = openLoansPreview.reduce((sum, loan) => {
    const p = Number(loan.principal);
    const interest = Number(loan.interestAmount);
    const { penaltyAmount } = computeAccruedLoanPenalty(p, loan.graceEndDate, nowForLoans);
    return sum + Math.max(0, p + interest + penaltyAmount - Number(loan.totalPaid || 0));
  }, 0);
  const preCalculatedLoanDeduction = Math.min(netPayout, estimatedLoanDue);
  const payoutAfterLoan = Math.max(0, netPayout - preCalculatedLoanDeduction);

  let fapshiResult: { transId: string };
  if (channel === "FAPSHI" && payoutAfterLoan > 0) {
    try {
      fapshiResult = await sendPayout({
        amount: Math.round(payoutAfterLoan),
        phone: normalizedPhone,
        medium,
        name: payoutName,
        externalId: `payout-${claim.id}`,
        message: `Cotisation DIVA - Gain de ${slot.beneficiaryName}`,
      });
    } catch (err) {
      if (err instanceof FapshiPayoutError) {
        return NextResponse.json(
          {
            error: `${err.message}. Si votre solde Fapshi Payout est à 0, utilisez le mode 'Portefeuille DIVA' ou 'Virement via mon numéro' (Direct).`,
          },
          { status: 502 },
        );
      }
      return NextResponse.json({ error: "Échec du virement Fapshi. Veuillez réessayer ou choisir 'Portefeuille DIVA' ou 'Virement Direct'." }, { status: 502 });
    }
  } else if (channel === "WALLET") {
    fapshiResult = {
      transId: `WALLET-${claim.id.slice(-8).toUpperCase()}`,
    };
  } else {
    // Virement direct via le numéro de l'admin (hors Fapshi) ou pot intégralement absorbé par le prêt
    fapshiResult = {
      transId: `MANUAL-${claim.id.slice(-8).toUpperCase()}`,
    };
  }

  let totalLoanDeducted = 0;
  let finalNetPayout = payoutAfterLoan;
  let totalDeducted = deducted;

  await prisma.$transaction(async (tx) => {
    if (toDeductFineIds.length > 0) {
      await tx.fine.updateMany({ where: { id: { in: toDeductFineIds } }, data: { status: "DEDUCTED" } });
    }
    for (const item of toDeductContributions) {
      await tx.contribution.upsert({
        where: {
          membershipSlotId_dueDate: {
            membershipSlotId: item.slotId,
            dueDate: claim.dueDate,
          },
        },
        create: {
          membershipSlotId: item.slotId,
          dueDate: claim.dueDate,
          amountPaid: item.amount,
          feePaid: item.fee,
          finePaid: 0,
          status: "PAID",
          paidAt: nowForLoans,
          failureReason: null,
        },
        update: {
          amountPaid: item.amount,
          feePaid: item.fee,
          finePaid: 0,
          status: "PAID",
          paidAt: nowForLoans,
          failureReason: null,
        },
      });
    }

    // Prélèvement automatique des prêts en cours sur le pot (Garantie Ultime)
    const loanRes = await deductActiveLoansFromPayoutTx(tx, {
      userId: user.id,
      payoutId: payoutClaimId,
      availableNetPayout: netPayout,
      now: nowForLoans,
    });
    totalLoanDeducted = loanRes.totalLoanDeducted;
    finalNetPayout = loanRes.remainingNetPayout;
    totalDeducted = deducted + totalLoanDeducted;

    // Crédit automatique à 100 % dans le Portefeuille Virtuel si channel === "WALLET"
    if (channel === "WALLET" && finalNetPayout > 0) {
      await creditWalletTx(tx, {
        userId: user.id,
        amount: finalNetPayout,
        fee: 0,
        type: "PAYOUT",
        description: `Encaissement cagnotte (${claim.tontineSession.title || claim.tontineSession.type} · ${slot.beneficiaryName})`,
        metadata: {
          payoutId: payoutClaimId,
          pot,
          totalDeducted,
          loanDeducted: totalLoanDeducted,
        },
      });
    }

    await tx.payout.update({
      where: { id: payoutClaimId },
      data: {
        status: "CONFIRMED",
        pot,
        deducted: totalDeducted,
        netPayout: finalNetPayout,
        payoutPhone: channel === "WALLET" ? "DIVA_WALLET" : normalizedPhone,
        payoutAccountName: payoutName,
        fapshiTransId: fapshiResult.transId,
        releasedByAdminId: admin.user.id,
        releasedAt: nowForLoans,
        memberConfirmedAt: nowForLoans,
        confirmedByAdmin: true,
      },
    });
  });

  const lang = user.preferredLang === "en" ? "en" : "fr";
  const baseReleaseMsg = payoutReleasedMessage(
    lang,
    user.name,
    slot.beneficiaryName,
    finalNetPayout,
    totalDeducted,
  );
  const loanNote =
    totalLoanDeducted > 0
      ? lang === "fr"
        ? `\n\n📌 Prélèvement prêt d'urgence à la source : -${formatXAF(totalLoanDeducted)} (capital + intérêts + pénalités éventuelles).`
        : `\n\n📌 Automatic emergency loan source deduction: -${formatXAF(totalLoanDeducted)}.`
      : "";
  const walletNote =
    channel === "WALLET"
      ? lang === "fr"
        ? `\nVotre Portefeuille DIVA Asso a été rechargé automatiquement de ${formatXAF(finalNetPayout)}. Vous pouvez retirer votre argent à tout moment, ou laisser une partie dans votre portefeuille pour cotiser sans payer de frais Orange ou MTN.`
        : `\nYour DIVA Asso Wallet was automatically credited with ${formatXAF(finalNetPayout)}. You can withdraw at any time, or keep part of it to pay future contributions with 0% Orange/MTN fees.`
      : "";
  const releaseMsg = `${baseReleaseMsg}${loanNote}${walletNote}`;

  if (totalLoanDeducted > 0) {
    await scheduleInAppNotifications({
      tontineSessionId: claim.tontineSessionId,
      type: "LOAN_DEDUCTED",
      recipients: [
        {
          userId: user.id,
          message:
            lang === "fr"
              ? `Un prélèvement automatique de ${formatXAF(totalLoanDeducted)} a été effectué sur votre cagnotte pour solder votre prêt d'urgence. Solde net versé : ${formatXAF(finalNetPayout)}.`
              : `Automatic deduction of ${formatXAF(totalLoanDeducted)} was taken from your pot to settle your emergency loan. Net disbursed: ${formatXAF(finalNetPayout)}.`,
          actionUrl: "/loans",
        },
      ],
    }).catch(() => {});
  }

  if (user.email) {
    const emailHtml = renderBrandedEmailHtml({
      title: lang === "fr" ? "Virement de cagnotte effectué ! 💰" : "Payout Disbursed! 💰",
      bodyText: releaseMsg,
      actionUrl: `/sessions/${claim.tontineSessionId}`,
      actionLabel: lang === "fr" ? "Consulter ma cagnotte" : "View My Pot",
      lang,
    });
    await sendEmailSafe(
      user.email,
      lang === "fr" ? "DIVA Asso — Virement de cagnotte effectué ! 💰" : "DIVA Asso — Payout Disbursed! 💰",
      emailHtml,
    );
  }

  // The round-robin just advanced — whoever getDesignatedSlot() now resolves
  // to (first slot by officialPosition with zero payout rows) is next in
  // line, for the first time. A one-time heads-up, distinct from the
  // "payout released" message above sent to the PREVIOUS beneficiary.
  const newDesignatedSlot = await getDesignatedSlot(claim.tontineSessionId);
  if (newDesignatedSlot && newDesignatedSlot.ballDrawn !== null) {
    const nextDueDate = getNextDueDate(claim.tontineSession.type, new Date());
    const approvedMemberships = await prisma.membership.findMany({
      where: { tontineSessionId: claim.tontineSessionId, status: "APPROVED" },
      include: { slots: true },
    });
    const allSlots = approvedMemberships.flatMap((m) => m.slots);
    const paidContributionsCount = await prisma.contribution.count({
      where: {
        membershipSlotId: { in: allSlots.map((s) => s.id) },
        dueDate: nextDueDate,
        status: "PAID",
      },
    });

    if (allSlots.length > 0 && paidContributionsCount >= allSlots.length) {
      const newBeneficiaryMembership = await prisma.membership.findFirst({
        where: { slots: { some: { id: newDesignatedSlot.id } } },
        include: { user: true },
      });
      if (newBeneficiaryMembership) {
      const totalApprovedSlots = approvedMemberships.reduce(
        (sum, m) => sum + (m.slotCount ? Number(m.slotCount) : 0),
        0,
      );
      const estimatedPot = Number(claim.tontineSession.amount) * totalApprovedSlots;
      const nextDueDate = getNextDueDate(claim.tontineSession.type, new Date());
      const beneficiaryUser = newBeneficiaryMembership.user;
      const sessionLabel =
        claim.tontineSession.title || TONTINE_TYPE_LABELS[claim.tontineSession.type] || claim.tontineSession.type;
      const beneficiaryLang = beneficiaryUser.preferredLang === "en" ? "en" : "fr";
      const firstName = beneficiaryUser.name.trim().split(/\s+/)[0] ?? beneficiaryUser.name;
      const dateLabel = nextDueDate.toLocaleDateString(beneficiaryLang === "fr" ? "fr-FR" : "en-GB", {
        timeZone: "Africa/Douala",
        day: "numeric",
        month: "long",
        year: "numeric",
      });

      const newDesignatedPosition = newDesignatedSlot.officialPosition!;
      const fullPayoutTurnMessage = payoutTurnMessage(
        beneficiaryLang,
        firstName,
        sessionLabel,
        estimatedPot,
        dateLabel,
        newDesignatedPosition,
      );


      if (beneficiaryUser.email) {
        const potEmailHtml = renderBrandedEmailHtml({
          title:
            beneficiaryLang === "fr"
              ? "DIVA Asso — C'est votre tour de bouffer la cagnotte ! 🎉"
              : "DIVA Asso — It's your turn to receive the payout! 🎉",
          bodyText: fullPayoutTurnMessage,
          actionUrl: `/sessions/${claim.tontineSessionId}`,
          actionLabel:
            beneficiaryLang === "fr"
              ? "Voir ma session & renseigner mes coordonnées"
              : "View Session & Enter Account Details",
          lang: beneficiaryLang,
        });
        await sendEmailSafe(
          beneficiaryUser.email,
          beneficiaryLang === "fr"
            ? "DIVA Asso — C'est votre tour de bouffer la cagnotte ! 🎉"
            : "DIVA Asso — It's your turn to receive the payout! 🎉",
          potEmailHtml,
        );
      }
      await scheduleInAppNotifications({
        tontineSessionId: claim.tontineSessionId,
        type: "PAYOUT_TURN",
        recipients: [
          {
            userId: beneficiaryUser.id,
            message:
              beneficiaryLang === "fr"
                ? `C'est votre tour de bouffer la cagnotte de ${sessionLabel} ! Veuillez fournir votre numéro de compte Mobile Money ou Orange Money et votre nom complet pour le virement.`
                : `It's your turn to receive the ${sessionLabel} payout! Please provide your Mobile Money / Orange Money account number and account name so the admin can process your payout.`,
            messageKey: "payoutTurnNotifMessage",
            messageVars: {
              cotisation: sessionLabel,
              amount: formatXAF(estimatedPot),
              date: dateLabel,
              position: String(newDesignatedPosition),
            },
            actionUrl: `/sessions/${claim.tontineSessionId}`,
          },
        ],
      });
    }
  }
}

  await logAudit({
    actorId: admin.user.id,
    actorRole: admin.user.role,
    action: "payout_released",
    targetType: "Payout",
    targetId: payoutClaimId,
    tontineSessionId: claim.tontineSessionId,
    metadata: {
      channel,
      netPayout,
      deducted,
      membershipSlotId: slot.id,
      payoutPhone: normalizedPhone,
      payoutAccountName: payoutName,
      provider,
      transId: fapshiResult.transId,
    },
    request,
  });

  return NextResponse.json({
    pot,
    deducted,
    netPayout,
    dueDate: claim.dueDate.toISOString(),
    transId: fapshiResult.transId,
    channel,
  });
}
