import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { computePayoutPreview } from "@/lib/payout-preview";
import { sendPayout, FapshiPayoutError } from "@/lib/fapshi-payout";
import { sendWhatsAppMessageSafe } from "@/lib/whatsapp/evolution";

const bodySchema = z.object({
  tontineSessionId: z.string().min(1),
  membershipSlotId: z.string().min(1),
});

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { tontineSessionId, membershipSlotId } = parsed.data;

  const [tontineSession, slot] = await Promise.all([
    prisma.tontineSession.findUnique({ where: { id: tontineSessionId } }),
    prisma.membershipSlot.findUnique({
      where: { id: membershipSlotId },
      include: { membership: { include: { user: true } } },
    }),
  ]);
  if (!tontineSession || !slot || slot.membership.tontineSessionId !== tontineSessionId) {
    return NextResponse.json({ error: "Session or slot not found" }, { status: 404 });
  }

  // Never trust a client-echoed amount — recompute server-side right before sending money.
  const { pot, deducted, netPayout, dueDate, toDeductFineIds } = await computePayoutPreview(tontineSession, slot);

  const existingPayout = await prisma.payout.findUnique({
    where: { tontineSessionId_dueDate: { tontineSessionId, dueDate } },
  });
  if (existingPayout) {
    return NextResponse.json({ error: "This cycle's payout has already been released" }, { status: 409 });
  }

  const { user } = slot.membership;
  const payoutPhone = user.payoutPhone ?? user.phone;
  if (!payoutPhone) {
    return NextResponse.json({ error: "This member has no payout phone number on file" }, { status: 400 });
  }

  let fapshiResult;
  try {
    fapshiResult = await sendPayout({
      amount: Math.round(netPayout),
      phone: payoutPhone,
      name: `${user.name} — ${slot.beneficiaryName}`,
      externalId: `${tontineSessionId}:${slot.id}:${dueDate.toISOString()}`,
      message: "DIVA Associations tontine payout",
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
    prisma.payout.create({
      data: {
        tontineSessionId,
        membershipSlotId,
        dueDate,
        pot,
        deducted,
        netPayout,
        fapshiTransId: fapshiResult.transId,
        releasedByAdminId: admin.user.id,
      },
    }),
  ]);

  await sendWhatsAppMessageSafe(
    user.phone,
    `🎉 Payout released — DIVA Associations\n\n` +
      `Congratulations ${user.name} (${slot.beneficiaryName})! Your payout of ${netPayout.toLocaleString("en-US")} F has been released` +
      (deducted > 0 ? ` after deducting ${deducted.toLocaleString("en-US")} F in outstanding fines.` : `.`),
  );

  return NextResponse.json({ pot, deducted, netPayout, dueDate: dueDate.toISOString() });
}
