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
      // Positions now live per-slot; a membership with multiple slots has no
      // single position, so this uses its first slot as a representative
      // value. Position swaps are still a membership-level feature (not yet
      // redesigned for slots) — see the schema's PositionSwapRequest note.
      const [requesterMembership, targetMembership] = await Promise.all([
        prisma.membership.findUnique({
          where: { userId_tontineSessionId: { userId: r.requesterId, tontineSessionId: r.tontineSessionId } },
          select: { slots: { orderBy: { createdAt: "asc" }, take: 1, select: { officialPosition: true, ballDrawn: true } } },
        }),
        prisma.membership.findUnique({
          where: { userId_tontineSessionId: { userId: r.targetId, tontineSessionId: r.tontineSessionId } },
          select: { slots: { orderBy: { createdAt: "asc" }, take: 1, select: { officialPosition: true, ballDrawn: true } } },
        }),
      ]);
      const requesterSlot = requesterMembership?.slots[0];
      const targetSlot = targetMembership?.slots[0];
      return {
        id: r.id,
        requesterName: r.requester.name,
        targetName: r.target.name,
        tontineSessionId: r.tontineSession.id,
        tontineType: r.tontineSession.type,
        requesterPosition: requesterSlot?.officialPosition ?? requesterSlot?.ballDrawn ?? null,
        targetPosition: targetSlot?.officialPosition ?? targetSlot?.ballDrawn ?? null,
      };
    }),
  );

  return NextResponse.json({ requests: withPositions });
}
