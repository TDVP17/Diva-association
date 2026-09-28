import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { computePayoutPreview } from "@/lib/payout-preview";
import { sendPayout, FapshiPayoutError } from "@/lib/fapshi-payout";
import { detectMobileMoneyProvider, fapshiMediumFor } from "@/lib/mobile-money-provider";
import { sendWhatsAppMessageSafe } from "@/lib/whatsapp/evolution";
import { payoutReleasedMessage } from "@/lib/whatsapp/templates";
import { getNextDueDate } from "@/lib/tontine-engine";
import { logAudit } from "@/lib/audit";

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

  const { pot, deducted, netPayout: computedNetPayout, toDeductFineIds } = await computePayoutPreview(
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
          status: "RELEASED",
          pot,
          deducted,
          netPayout,
          fapshiTransId: fapshiResult.transId,
          releasedByAdminId: admin.user.id,
          releasedAt: new Date(),
        },
      })
    : await prisma.payout.create({
        data: {
          tontineSessionId,
          membershipSlotId,
          dueDate,
          payoutPhone: normalized,
          payoutAccountName,
          status: "RELEASED",
          pot,
          deducted,
          netPayout,
          fapshiTransId: fapshiResult.transId,
          releasedByAdminId: admin.user.id,
          releasedAt: new Date(),
        },
      });

  if (toDeductFineIds.length > 0) {
    await prisma.fine.updateMany({
      where: { id: { in: toDeductFineIds } },
      data: { status: "DEDUCTED" },
    });
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

  await sendWhatsAppMessageSafe(user.phone, releaseMsg);

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
