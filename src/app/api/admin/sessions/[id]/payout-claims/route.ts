import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id: tontineSessionId } = await params;

  const claims = await prisma.payout.findMany({
    where: { tontineSessionId },
    include: { membershipSlot: { include: { membership: { include: { user: true } } } } },
    orderBy: { detailsSubmittedAt: "desc" },
  });

  return NextResponse.json({
    claims: claims.map((c) => ({
      id: c.id,
      status: c.status,
      beneficiaryName: c.membershipSlot.beneficiaryName,
      memberName: c.membershipSlot.membership.user.name,
      payoutPhone: c.payoutPhone,
      payoutAccountName: c.payoutAccountName,
      netPayout: c.netPayout ? Number(c.netPayout) : null,
      detailsSubmittedAt: c.detailsSubmittedAt.toISOString(),
      releasedAt: c.releasedAt?.toISOString() ?? null,
      memberConfirmedAt: c.memberConfirmedAt?.toISOString() ?? null,
      confirmedByAdmin: c.confirmedByAdmin,
    })),
  });
}
