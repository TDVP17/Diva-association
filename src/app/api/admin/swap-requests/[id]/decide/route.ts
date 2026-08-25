import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";

const bodySchema = z.object({ action: z.enum(["approve", "reject"]) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { id } = await params;
  const swapRequest = await prisma.positionSwapRequest.findUnique({ where: { id } });
  if (!swapRequest) {
    return NextResponse.json({ error: "Swap request not found" }, { status: 404 });
  }
  if (swapRequest.status !== "PENDING_ADMIN") {
    return NextResponse.json({ error: "This request is not awaiting admin approval" }, { status: 409 });
  }

  if (parsed.data.action === "reject") {
    await prisma.positionSwapRequest.update({ where: { id }, data: { status: "REJECTED" } });
    return NextResponse.json({ ok: true, status: "REJECTED" });
  }

  // Position swaps are still a membership-level feature (not yet redesigned
  // for slots — see the schema's PositionSwapRequest note); this swaps each
  // membership's first slot as a representative stand-in.
  const [requesterMembership, targetMembership] = await Promise.all([
    prisma.membership.findUnique({
      where: {
        userId_tontineSessionId: {
          userId: swapRequest.requesterId,
          tontineSessionId: swapRequest.tontineSessionId,
        },
      },
      include: { slots: { orderBy: { createdAt: "asc" }, take: 1 } },
    }),
    prisma.membership.findUnique({
      where: {
        userId_tontineSessionId: {
          userId: swapRequest.targetId,
          tontineSessionId: swapRequest.tontineSessionId,
        },
      },
      include: { slots: { orderBy: { createdAt: "asc" }, take: 1 } },
    }),
  ]);
  const requesterSlot = requesterMembership?.slots[0];
  const targetSlot = targetMembership?.slots[0];
  if (!requesterSlot || !targetSlot) {
    return NextResponse.json({ error: "One of the members has no registered slot" }, { status: 404 });
  }

  await prisma.$transaction([
    prisma.membershipSlot.update({
      where: { id: requesterSlot.id },
      data: { officialPosition: targetSlot.officialPosition, ballDrawn: targetSlot.ballDrawn },
    }),
    prisma.membershipSlot.update({
      where: { id: targetSlot.id },
      data: { officialPosition: requesterSlot.officialPosition, ballDrawn: requesterSlot.ballDrawn },
    }),
    prisma.positionSwapRequest.update({ where: { id }, data: { status: "APPROVED" } }),
  ]);

  return NextResponse.json({ ok: true, status: "APPROVED" });
}
