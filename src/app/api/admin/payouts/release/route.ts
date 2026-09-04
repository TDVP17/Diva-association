import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { computePayoutPreview } from "@/lib/payout-preview";
import { sendPayout, FapshiPayoutError } from "@/lib/fapshi-payout";
import { sendWhatsAppMessageSafe } from "@/lib/whatsapp/evolution";
import { payoutTurnMessage, payoutReleasedMessage } from "@/lib/whatsapp/templates";
import { scheduleInAppNotifications, scheduleNotifications } from "@/lib/notifications/dispatch";
import { getDesignatedSlot } from "@/lib/round-robin-lock";
import { getNextDueDate } from "@/lib/tontine-engine";
import { TONTINE_TYPE_LABELS } from "@/lib/tontine-labels";
import { logAudit } from "@/lib/audit";
import { formatXAF } from "@/lib/format-currency";

const bodySchema = z.object({ payoutClaimId: z.string().min(1) });

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { payoutClaimId } = parsed.data;

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

  // Never trust a client-echoed amount — recompute server-side right before sending money.
  const { pot, deducted, netPayout, toDeductFineIds } = await computePayoutPreview(
    claim.tontineSession,
    slot,
    claim.dueDate,
  );

  let fapshiResult;
  try {
    fapshiResult = await sendPayout({
      amount: Math.round(netPayout),
      phone: claim.payoutPhone,
      name: claim.payoutAccountName,
      externalId: `${claim.tontineSessionId}:${slot.id}:${claim.dueDate.toISOString()}`,
      message: "DIVA Association tontine payout",
    });
  } catch (err) {
    if (err instanceof FapshiPayoutError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return NextResponse.json({ error: "Payout could not be sent. Please try again." }, { status: 502 });
  }

  await prisma.$transaction([
    ...(toDeductFineIds.length > 0
      ? [prisma.fine.updateMany({ where: { id: { in: toDeductFineIds } }, data: { status: "DEDUCTED" } })]
      : []),
    prisma.payout.update({
      where: { id: payoutClaimId },
      data: {
        status: "RELEASED",
        pot,
        deducted,
        netPayout,
        fapshiTransId: fapshiResult.transId,
        releasedByAdminId: admin.user.id,
        releasedAt: new Date(),
      },
    }),
  ]);

  await sendWhatsAppMessageSafe(
    user.phone,
    payoutReleasedMessage(
      user.preferredLang === "fr" ? "fr" : "en",
      user.name,
      slot.beneficiaryName,
      netPayout,
      deducted,
    ),
  );

  // The round-robin just advanced — whoever getDesignatedSlot() now resolves
  // to (first slot by officialPosition with zero payout rows) is next in
  // line, for the first time. A one-time heads-up, distinct from the
  // "payout released" message above sent to the PREVIOUS beneficiary.
  const newDesignatedSlot = await getDesignatedSlot(claim.tontineSessionId);
  if (newDesignatedSlot) {
    const newBeneficiaryMembership = await prisma.membership.findFirst({
      where: { slots: { some: { id: newDesignatedSlot.id } } },
      include: { user: true },
    });
    if (newBeneficiaryMembership) {
      const approvedMemberships = await prisma.membership.findMany({
        where: { tontineSessionId: claim.tontineSessionId, status: "APPROVED" },
        select: { slotCount: true },
      });
      const totalApprovedSlots = approvedMemberships.reduce(
        (sum, m) => sum + (m.slotCount ? Number(m.slotCount) : 0),
        0,
      );
      const estimatedPot = Number(claim.tontineSession.amount) * totalApprovedSlots;
      const nextDueDate = getNextDueDate(claim.tontineSession.type, new Date());
      const beneficiaryUser = newBeneficiaryMembership.user;
      const sessionLabel =
        claim.tontineSession.title || TONTINE_TYPE_LABELS[claim.tontineSession.type] || claim.tontineSession.type;
      const beneficiaryLang = beneficiaryUser.preferredLang === "fr" ? "fr" : "en";
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

      await sendWhatsAppMessageSafe(beneficiaryUser.phone, fullPayoutTurnMessage);
      await scheduleNotifications({
        tontineSessionId: claim.tontineSessionId,
        channel: "EMAIL",
        type: "PAYOUT_TURN",
        recipients: [{ userId: beneficiaryUser.id, message: fullPayoutTurnMessage }],
      });
      await scheduleInAppNotifications({
        tontineSessionId: claim.tontineSessionId,
        type: "PAYOUT_TURN",
        recipients: [
          {
            userId: beneficiaryUser.id,
            message: `It's your turn to receive the ${sessionLabel} payout (position #${newDesignatedPosition}) — estimated ${formatXAF(estimatedPot)}, expected around ${dateLabel}.`,
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

  await logAudit({
    actorId: admin.user.id,
    actorRole: admin.user.role,
    action: "payout_released",
    targetType: "Payout",
    targetId: payoutClaimId,
    tontineSessionId: claim.tontineSessionId,
    metadata: { netPayout, deducted, membershipSlotId: slot.id },
    request,
  });

  return NextResponse.json({ pot, deducted, netPayout, dueDate: claim.dueDate.toISOString() });
}
