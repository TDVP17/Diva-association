import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { computePayoutPreview } from "@/lib/payout-preview";
import { getNextDueDate } from "@/lib/tontine-engine";
import { logAudit } from "@/lib/audit";
import { getDesignatedSlot } from "@/lib/round-robin-lock";
import { payoutReleasedMessage, payoutTurnMessage } from "@/lib/whatsapp/templates";
import { sendEmailSafe } from "@/lib/email/resend";
import { renderBrandedEmailHtml } from "@/lib/email/template";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import { TONTINE_TYPE_LABELS } from "@/lib/tontine-labels";
import { formatXAF } from "@/lib/format-currency";

const confirmTurnSchema = z.object({
  tontineSessionId: z.string().min(1),
  membershipSlotId: z.string().min(1),
  payoutPhone: z.string().trim().optional(),
  payoutAccountName: z.string().trim().optional(),
  customAmount: z.coerce.number().positive().optional(),
});

function normalizeCameroonPhone(raw?: string | null): string {
  if (!raw) return "";
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00237") && digits.length > 9) digits = digits.slice(5);
  if (digits.startsWith("237") && digits.length > 9) digits = digits.slice(3);
  return digits;
}

/**
 * Action admin directe : Cocher le nom d'un membre pour attester qu'il a perçu / bouffé son argent
 * et passer immédiatement au tour / cycle de cotisation suivant.
 */
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = confirmTurnSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Paramètres invalides" }, { status: 400 });
  }

  const { tontineSessionId, membershipSlotId, payoutPhone, payoutAccountName, customAmount } =
    parsed.data;

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
    return NextResponse.json({ error: "Part introuvable dans cette cotisation" }, { status: 404 });
  }

  const session = slot.membership.tontineSession;
  const user = slot.membership.user;
  const dueDate = getNextDueDate(session.type, new Date());

  // Existing payout claim or row if any
  const existingPayout = await prisma.payout.findFirst({
    where: {
      tontineSessionId,
      membershipSlotId,
    },
    orderBy: { detailsSubmittedAt: "desc" },
  });

  const { pot, deducted, netPayout: computedNetPayout, toDeductFineIds, toDeductContributions } =
    await computePayoutPreview(session, slot, dueDate);

  const netPayout = customAmount ?? computedNetPayout;
  const effectivePhone = normalizeCameroonPhone(
    payoutPhone || existingPayout?.payoutPhone || user.phone || "600000000",
  );
  const effectiveAccountName =
    (payoutAccountName || existingPayout?.payoutAccountName || slot.beneficiaryName || user.name)
      .trim();

  const confirmedDate = new Date();
  const transId =
    existingPayout?.fapshiTransId ||
    `CONFIRMED-${slot.id.slice(-6).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;

  const payoutRecord = existingPayout
    ? await prisma.payout.update({
        where: { id: existingPayout.id },
        data: {
          payoutPhone: effectivePhone,
          payoutAccountName: effectiveAccountName,
          status: "CONFIRMED",
          pot,
          deducted,
          netPayout,
          fapshiTransId: transId,
          releasedByAdminId: admin.user.id,
          releasedAt: existingPayout.releasedAt ?? confirmedDate,
          memberConfirmedAt: confirmedDate,
          confirmedByAdmin: true,
        },
      })
    : await prisma.payout.create({
        data: {
          tontineSessionId,
          membershipSlotId,
          dueDate,
          payoutPhone: effectivePhone,
          payoutAccountName: effectiveAccountName,
          status: "CONFIRMED",
          pot,
          deducted,
          netPayout,
          fapshiTransId: transId,
          releasedByAdminId: admin.user.id,
          releasedAt: confirmedDate,
          memberConfirmedAt: confirmedDate,
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
            paidAt: confirmedDate,
            failureReason: null,
          },
          update: {
            amountPaid: item.amount,
            feePaid: item.fee,
            finePaid: 0,
            status: "PAID",
            paidAt: confirmedDate,
            failureReason: null,
          },
        }),
      ),
    );
  }

  // Send confirmation notification & email to the beneficiary
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
      title: userLang === "fr" ? "Virement de cagnotte confirmé ! 💰" : "Payout Confirmed! 💰",
      bodyText: releaseMsg,
      actionUrl: `/sessions/${tontineSessionId}`,
      actionLabel: userLang === "fr" ? "Consulter ma cagnotte" : "View My Pot",
      lang: userLang,
    });
    await sendEmailSafe(
      user.email,
      userLang === "fr"
        ? "DIVA Asso — Virement de cagnotte confirmé ! 💰"
        : "DIVA Asso — Payout Confirmed! 💰",
      emailHtml,
    );
  }

  await prisma.notification.create({
    data: {
      userId: user.id,
      tontineSessionId,
      channel: "IN_APP",
      type: "PAYOUT_TURN",
      message: `Votre cagnotte de gain (${slot.beneficiaryName}) de ${Math.round(netPayout)} FCFA a été validée et enregistrée !`,
      messageKey: "payoutReleasedInApp",
      messageVars: { name: slot.beneficiaryName, amount: String(Math.round(netPayout)) },
      status: "SENT",
      readAt: null,
      actionUrl: `/sessions/${tontineSessionId}`,
    },
  });

  // Check and alert next designated beneficiary
  const newDesignatedSlot = await getDesignatedSlot(tontineSessionId);
  if (newDesignatedSlot && newDesignatedSlot.ballDrawn !== null) {
    const nextDue = getNextDueDate(session.type, new Date());
    const newBeneficiaryMembership = await prisma.membership.findFirst({
      where: { slots: { some: { id: newDesignatedSlot.id } } },
      include: { user: true },
    });
    if (newBeneficiaryMembership) {
      const allApprovedSlots = await prisma.membershipSlot.findMany({
        where: { membership: { tontineSessionId, status: "APPROVED" } },
      });
      const estimatedPot = Number(session.amount) * allApprovedSlots.length;
      const beneficiaryUser = newBeneficiaryMembership.user;
      const sessionLabel = session.title || TONTINE_TYPE_LABELS[session.type] || session.type;
      const beneficiaryLang = beneficiaryUser.preferredLang === "en" ? "en" : "fr";
      const firstName = beneficiaryUser.name.trim().split(/\s+/)[0] ?? beneficiaryUser.name;
      const dateLabel = nextDue.toLocaleDateString(
        beneficiaryLang === "fr" ? "fr-FR" : "en-GB",
        {
          timeZone: "Africa/Douala",
          day: "numeric",
          month: "long",
          year: "numeric",
        },
      );

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
          actionLabel: beneficiaryLang === "fr" ? "Voir ma session" : "View My Session",
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
                : `It's your turn to receive the ${sessionLabel} payout! Please provide your Mobile Money / Orange Money account number and account name so DIVA Asso can process your payout.`,
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

  await logAudit({
    actorId: admin.user.id,
    actorRole: admin.user.role,
    action: "payout_confirmed_by_admin_override",
    targetType: "Payout",
    targetId: payoutRecord.id,
    tontineSessionId,
    metadata: {
      action: "marked_pot_bouffed",
      membershipSlotId,
      beneficiaryName: slot.beneficiaryName,
      netPayout,
      payoutPhone: effectivePhone,
      payoutAccountName: effectiveAccountName,
    },
    request,
  });

  return NextResponse.json({
    ok: true,
    payoutId: payoutRecord.id,
    netPayout,
    transId,
    beneficiaryName: slot.beneficiaryName,
    nextSlotBeneficiaryName: newDesignatedSlot?.beneficiaryName ?? null,
  });
}
