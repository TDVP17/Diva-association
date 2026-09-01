import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { computePayoutPreview } from "@/lib/payout-preview";
import { sendPayout, FapshiPayoutError } from "@/lib/fapshi-payout";
import { sendWhatsAppMessageSafe } from "@/lib/whatsapp/evolution";
import { logAudit } from "@/lib/audit";

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
    `🎉 Payout released — DIVA Association\n\n` +
      `Congratulations ${user.name} (${slot.beneficiaryName})! Your payout of ${netPayout.toLocaleString("en-US")} F has been released` +
      (deducted > 0 ? ` after deducting ${deducted.toLocaleString("en-US")} F in outstanding fines.` : `.`) +
      ` Confirm on the app once you've received it.`,
  );

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
