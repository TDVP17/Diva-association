import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: tontineSessionId } = await params;

  const slots = await prisma.membershipSlot.findMany({
    where: {
      membership: { tontineSessionId, status: "APPROVED" },
      ballDrawn: { not: null },
    },
    include: {
      membership: { include: { user: { select: { name: true } } } },
      payouts: { orderBy: { detailsSubmittedAt: "desc" }, take: 1 },
    },
    orderBy: { officialPosition: "asc" },
  });

  const rows = slots.map((s) => {
    const payout = s.payouts[0] ?? null;
    return {
      position: s.officialPosition,
      beneficiaryName: s.beneficiaryName,
      memberName: s.membership.user.name,
      status: payout?.status ?? "pending",
      confirmedByAdmin: payout?.confirmedByAdmin ?? false,
      releasedAt: payout?.releasedAt?.toISOString() ?? null,
      memberConfirmedAt: payout?.memberConfirmedAt?.toISOString() ?? null,
    };
  });

  return NextResponse.json({ rows });
}
