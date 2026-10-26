import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { computePayoutPreview } from "@/lib/payout-preview";
import { sendPayout, FapshiPayoutError } from "@/lib/fapshi-payout";
import { detectMobileMoneyProvider, fapshiMediumFor } from "@/lib/mobile-money-provider";
import { sendEmailSafe } from "@/lib/email/resend";
import { renderBrandedEmailHtml } from "@/lib/email/template";
import { payoutReleasedMessage } from "@/lib/whatsapp/templates";
import { getNextDueDate } from "@/lib/tontine-engine";
import { logAudit } from "@/lib/audit";
import { getDesignatedSlot } from "@/lib/round-robin-lock";
import { payoutTurnMessage } from "@/lib/whatsapp/templates";
import { scheduleInAppNotifications, scheduleNotifications } from "@/lib/notifications/dispatch";
import { TONTINE_TYPE_LABELS } from "@/lib/tontine-labels";
import { formatXAF } from "@/lib/format-currency";

const directPayoutSchema = z.object({
  tontineSessionId: z.string().min(1),
  membershipSlotId: z.string().min(1),
  payoutPhone: z.string().trim().min(9),
  payoutAccountName: z.string().trim().min(1).max(100),
  customAmount: z.coerce.number().positive().optional(),
});

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("237") && digits.length === 12) {
    return digits.slice(3);
  }
  return digits;
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = directPayoutSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { tontineSessionId, membershipSlotId, payoutPhone, payoutAccountName, customAmount } = parsed.data;

  const slot = await prisma.membershipSlot.findUnique({
    where: { id: membershipSlotId },
    include: {
      membership: {
        include: {
          user: true,
          tontineSession: true,
        },
      },
    },
  });

  if (!slot || slot.membership.tontineSessionId !== tontineSessionId) {
    return NextResponse.json({ error: "Slot not found in this cotisation" }, { status: 404 });
  }

  const session = slot.membership.tontineSession;
  const user = slot.membership.user;
  const dueDate = getNextDueDate(session.type, new Date());

  // Check if payout has already been processed for this cycle
  const existingPayout = await prisma.payout.findFirst({
    where: {
      tontineSessionId,
      membershipSlotId,
      dueDate,
    },
  });

  if (existingPayout && existingPayout.status !== "DETAILS_SUBMITTED") {
    return NextResponse.json(
      { error: "A payout has already been released or confirmed for this slot in this cycle" },
      { status: 409 },
    );
  }

  // Règle Diva : c'est uniquement lorsque tout le monde a cotisé (y compris le bénéficiaire) que la cagnotte peut être versée
  const allApprovedSlots = await prisma.membershipSlot.findMany({
    where: {
      membership: { tontineSessionId, status: "APPROVED" },
    },
    select: { id: true, beneficiaryName: true },
  });

  const unpaidSlots = await prisma.membershipSlot.findMany({
    where: {
      id: { in: allApprovedSlots.map((s) => s.id) },
      contributions: {
        none: {
          dueDate,
          status: "PAID",
        },
      },
    },
    select: { beneficiaryName: true },
  });

  if (unpaidSlots.length > 0) {
    const unpaidNames = unpaidSlots.map((s) => s.beneficiaryName).join(", ");
    return NextResponse.json(
      {
        error: `Impossible de verser la cagnotte : tous les membres doivent avoir cotisé avant le versement. Noms en attente (${unpaidSlots.length}) : ${unpaidNames}.`,
      },
      { status: 409 },
    );
  }

  const { pot, deducted, netPayout: computedNetPayout, toDeductFineIds, toDeductContributions } = await computePayoutPreview(
    session,
    slot,
    dueDate,
  );

  const netPayout = customAmount ?? computedNetPayout;
  const normalized = normalizePhone(payoutPhone);
  const provider = detectMobileMoneyProvider(normalized);
  const medium = provider ? fapshiMediumFor(provider) : undefined;

  let fapshiResult;
  try {
    fapshiResult = await sendPayout({
      amount: Math.round(netPayout),
      phone: normalized,
      medium,
      name: payoutAccountName,
      externalId: `${tontineSessionId}:${slot.id}:${dueDate.toISOString()}`,
      message: `Cotisation DIVA - Gain de ${slot.beneficiaryName}`,
    });
  } catch (err) {
    console.error("[admin/payouts/direct] Fapshi payout error:", err);
    if (err instanceof FapshiPayoutError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return NextResponse.json(
      { error: "Le virement Fapshi a échoué. Veuillez vérifier le solde Fapshi ou le numéro." },
      { status: 502 },
    );
  }

  // Persist payout row
  const payoutRecord = existingPayout
    ? await prisma.payout.update({
        where: { id: existingPayout.id },
        data: {
          payoutPhone: normalized,
          payoutAccountName,
          status: "CONFIRMED",
          pot,
          deducted,
          netPayout,
          fapshiTransId: fapshiResult.transId,
          releasedByAdminId: admin.user.id,
          releasedAt: new Date(),
          memberConfirmedAt: new Date(),
          confirmedByAdmin: true,
        },
      })
    : await prisma.payout.create({
        data: {
          tontineSessionId,
          membershipSlotId,
          dueDate,
          payoutPhone: normalized,
          payoutAccountName,
          status: "CONFIRMED",
          pot,
          deducted,
          netPayout,
          fapshiTransId: fapshiResult.transId,
          releasedByAdminId: admin.user.id,
          releasedAt: new Date(),
          memberConfirmedAt: new Date(),
          confirmedByAdmin: true,
        },
      });

  if (toDeductFineIds.length > 0) {
    await prisma.fine.updateMany({
      where: { id: { in: toDeductFineIds } },
      data: { status: "DEDUCTED" },
    });
  }

  if (toDeductContributions.length > 0) {
    await Promise.all(
      toDeductContributions.map((item) =>
        prisma.contribution.upsert({
          where: {
            membershipSlotId_dueDate: {
              membershipSlotId: item.slotId,
              dueDate,
            },
          },
          create: {
            membershipSlotId: item.slotId,
            dueDate,
            amountPaid: item.amount,
            feePaid: item.fee,
            finePaid: 0,
            status: "PAID",
            paidAt: new Date(),
            failureReason: null,
          },
          update: {
            amountPaid: item.amount,
            feePaid: item.fee,
            finePaid: 0,
            status: "PAID",
            paidAt: new Date(),
            failureReason: null,
          },
        }),
      ),
    );
  }

  // Send notifications
  const userLang = user.preferredLang === "en" ? "en" : "fr";
  const releaseMsg = payoutReleasedMessage(
    userLang,
    user.name,
    slot.beneficiaryName,
    netPayout,
    deducted,
  );

  if (user.email) {
    const emailHtml = renderBrandedEmailHtml({
      title: userLang === "fr" ? "Virement de cagnotte effectué ! 💰" : "Payout Disbursed! 💰",
      bodyText: releaseMsg,
      actionUrl: `/sessions/${tontineSessionId}`,
      actionLabel: userLang === "fr" ? "Consulter ma cagnotte" : "View My Pot",
      lang: userLang,
    });
    await sendEmailSafe(
      user.email,
      userLang === "fr" ? "DIVA Asso — Virement de cagnotte effectué ! 💰" : "DIVA Asso — Payout Disbursed! 💰",
      emailHtml,
    );
  }

  await prisma.notification.create({
    data: {
      userId: user.id,
      tontineSessionId,
      channel: "IN_APP",
      type: "PAYOUT_TURN",
      message: `Votre virement de gain (${slot.beneficiaryName}) de ${Math.round(netPayout)} FCFA a été envoyé directement sur votre compte ${payoutAccountName} (${normalized}) !`,
      messageKey: "payoutReleasedInApp",
      messageVars: { name: slot.beneficiaryName, amount: String(Math.round(netPayout)) },
      status: "SENT",
      readAt: null,
      actionUrl: `/sessions/${tontineSessionId}`,
    },
  });

  // Notify next designated beneficiary only if their ball is drawn AND at least half have contributed
  const newDesignatedSlot = await getDesignatedSlot(tontineSessionId);
  if (newDesignatedSlot && newDesignatedSlot.ballDrawn !== null) {
    const nextDue = getNextDueDate(session.type, new Date());
    const approvedMemberships = await prisma.membership.findMany({
      where: { tontineSessionId, status: "APPROVED" },
      include: { slots: true },
    });
    const allSlots = approvedMemberships.flatMap((m) => m.slots);
    const paidContributionsCount = await prisma.contribution.count({
      where: {
        membershipSlotId: { in: allSlots.map((s) => s.id) },
        dueDate: nextDue,
        status: "PAID",
      },
    });

    if (allSlots.length > 0 && paidContributionsCount >= allSlots.length) {
      const newBeneficiaryMembership = await prisma.membership.findFirst({
        where: { slots: { some: { id: newDesignatedSlot.id } } },
        include: { user: true },
      });
      if (newBeneficiaryMembership) {
        const totalApprovedSlots = allSlots.length;
        const estimatedPot = Number(session.amount) * totalApprovedSlots;
        const beneficiaryUser = newBeneficiaryMembership.user;
        const sessionLabel = session.title || TONTINE_TYPE_LABELS[session.type] || session.type;
        const beneficiaryLang = beneficiaryUser.preferredLang === "en" ? "en" : "fr";
        const firstName = beneficiaryUser.name.trim().split(/\s+/)[0] ?? beneficiaryUser.name;
        const dateLabel = nextDue.toLocaleDateString(beneficiaryLang === "fr" ? "fr-FR" : "en-GB", {
          timeZone: "Africa/Douala",
          day: "numeric",
          month: "long",
          year: "numeric",
        });

        const newDesignatedPosition = newDesignatedSlot.officialPosition ?? 1;
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
            actionUrl: `/sessions/${tontineSessionId}`,
            actionLabel:
              beneficiaryLang === "fr"
                ? "Voir ma session"
                : "View My Session",
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
          tontineSessionId,
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
              actionUrl: `/sessions/${tontineSessionId}`,
            },
          ],
        });
      }
    }
  }

  await logAudit({
    actorId: admin.user.id,
    actorRole: admin.user.role,
    action: "direct_payout_released",
    targetType: "Payout",
    targetId: payoutRecord.id,
    tontineSessionId,
    metadata: {
      membershipSlotId,
      netPayout,
      payoutPhone: normalized,
      payoutAccountName,
      provider,
      transId: fapshiResult.transId,
    },
    request,
  });

  return NextResponse.json({
    ok: true,
    payoutId: payoutRecord.id,
    netPayout,
    transId: fapshiResult.transId,
    provider,
  });
}
