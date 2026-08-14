import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const createSchema = z.object({
  targetId: z.string().min(1),
  tontineSessionId: z.string().min(1),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { targetId, tontineSessionId } = parsed.data;

  if (targetId === session.user.id) {
    return NextResponse.json({ error: "You cannot request a swap with yourself" }, { status: 400 });
  }

  const [requesterMembership, targetMembership, existing] = await Promise.all([
    prisma.membership.findUnique({
      where: { userId_tontineSessionId: { userId: session.user.id, tontineSessionId } },
    }),
    prisma.membership.findUnique({
      where: { userId_tontineSessionId: { userId: targetId, tontineSessionId } },
    }),
    prisma.positionSwapRequest.findFirst({
      where: {
        tontineSessionId,
        status: { in: ["PENDING_MEMBERSHIP", "PENDING_ADMIN"] },
        OR: [
          { requesterId: session.user.id, targetId },
          { requesterId: targetId, targetId: session.user.id },
        ],
      },
    }),
  ]);

  if (!requesterMembership || !targetMembership) {
    return NextResponse.json(
      { error: "Both members must belong to this tontine session" },
      { status: 404 },
    );
  }
  if (existing) {
    return NextResponse.json(
      { error: "There is already a pending swap request between you two" },
      { status: 409 },
    );
  }

  const swapRequest = await prisma.positionSwapRequest.create({
    data: { requesterId: session.user.id, targetId, tontineSessionId },
    include: { tontineSession: true },
  });

  return NextResponse.json({
    kind: "swap_request" as const,
    id: swapRequest.id,
    requesterId: swapRequest.requesterId,
    targetId: swapRequest.targetId,
    status: swapRequest.status,
    tontineType: swapRequest.tontineSession.type,
    createdAt: swapRequest.createdAt.toISOString(),
  });
}
