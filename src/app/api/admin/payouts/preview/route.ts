import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { computePayoutPreview } from "@/lib/payout-preview";

export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(request.url);
  const tontineSessionId = url.searchParams.get("tontineSessionId");
  const membershipSlotId = url.searchParams.get("membershipSlotId");
  if (!tontineSessionId || !membershipSlotId) {
    return NextResponse.json({ error: "Missing query params" }, { status: 400 });
  }

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

  const preview = await computePayoutPreview(tontineSession, slot);

  return NextResponse.json({
    pot: preview.pot,
    deducted: preview.deducted,
    netPayout: preview.netPayout,
    dueDate: preview.dueDate.toISOString(),
    beneficiaryName: slot.beneficiaryName,
    memberName: slot.membership.user.name,
    memberPhone: slot.membership.user.payoutPhone ?? slot.membership.user.phone,
  });
}
