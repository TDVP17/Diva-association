import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { computePayoutPreview } from "@/lib/payout-preview";

export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const payoutClaimId = new URL(request.url).searchParams.get("payoutClaimId");
  if (!payoutClaimId) {
    return NextResponse.json({ error: "Missing payoutClaimId" }, { status: 400 });
  }

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
  const preview = await computePayoutPreview(claim.tontineSession, slot, claim.dueDate);

  return NextResponse.json({
    pot: preview.pot,
    deducted: preview.deducted,
    netPayout: preview.netPayout,
    dueDate: preview.dueDate.toISOString(),
    beneficiaryName: slot.beneficiaryName,
    memberName: slot.membership.user.name,
    payoutPhone: claim.payoutPhone,
    payoutAccountName: claim.payoutAccountName,
  });
}
