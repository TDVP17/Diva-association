import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const requests = await prisma.positionSwapRequest.findMany({
    where: { status: "PENDING_ADMIN" },
    include: {
      requester: { select: { id: true, name: true } },
      target: { select: { id: true, name: true } },
      tontineSession: { select: { id: true, type: true } },
    },
    orderBy: { updatedAt: "asc" },
  });

  const withPositions = await Promise.all(
    requests.map(async (r) => {
      const [requesterMembership, targetMembership] = await Promise.all([
        prisma.membership.findUnique({
          where: { userId_tontineSessionId: { userId: r.requesterId, tontineSessionId: r.tontineSessionId } },
          select: { officialPosition: true, ballDrawn: true },
        }),
        prisma.membership.findUnique({
          where: { userId_tontineSessionId: { userId: r.targetId, tontineSessionId: r.tontineSessionId } },
          select: { officialPosition: true, ballDrawn: true },
        }),
      ]);
      return {
        id: r.id,
        requesterName: r.requester.name,
        targetName: r.target.name,
        tontineSessionId: r.tontineSession.id,
        tontineType: r.tontineSession.type,
        requesterPosition: requesterMembership?.officialPosition ?? requesterMembership?.ballDrawn ?? null,
        targetPosition: targetMembership?.officialPosition ?? targetMembership?.ballDrawn ?? null,
      };
    }),
  );

  return NextResponse.json({ requests: withPositions });
}
