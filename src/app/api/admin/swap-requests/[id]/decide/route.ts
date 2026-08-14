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

  const [requesterMembership, targetMembership] = await Promise.all([
    prisma.membership.findUnique({
      where: {
        userId_tontineSessionId: {
          userId: swapRequest.requesterId,
          tontineSessionId: swapRequest.tontineSessionId,
        },
      },
    }),
    prisma.membership.findUnique({
      where: {
        userId_tontineSessionId: {
          userId: swapRequest.targetId,
          tontineSessionId: swapRequest.tontineSessionId,
        },
      },
    }),
  ]);
  if (!requesterMembership || !targetMembership) {
    return NextResponse.json({ error: "One of the memberships no longer exists" }, { status: 404 });
  }

  await prisma.$transaction([
    prisma.membership.update({
      where: { id: requesterMembership.id },
      data: {
        officialPosition: targetMembership.officialPosition,
        ballDrawn: targetMembership.ballDrawn,
      },
    }),
    prisma.membership.update({
      where: { id: targetMembership.id },
      data: {
        officialPosition: requesterMembership.officialPosition,
        ballDrawn: requesterMembership.ballDrawn,
      },
    }),
    prisma.positionSwapRequest.update({ where: { id }, data: { status: "APPROVED" } }),
  ]);

  return NextResponse.json({ ok: true, status: "APPROVED" });
}
