import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const respondSchema = z.object({
  action: z.enum(["accept", "decline"]),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = respondSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { id } = await params;
  const swapRequest = await prisma.positionSwapRequest.findUnique({ where: { id } });
  if (!swapRequest) {
    return NextResponse.json({ error: "Swap request not found" }, { status: 404 });
  }
  if (swapRequest.targetId !== session.user.id) {
    return NextResponse.json({ error: "Only the requested member can respond" }, { status: 403 });
  }
  if (swapRequest.status !== "PENDING_MEMBERSHIP") {
    return NextResponse.json({ error: "This request has already been resolved" }, { status: 409 });
  }

  const updated = await prisma.positionSwapRequest.update({
    where: { id },
    data: { status: parsed.data.action === "accept" ? "PENDING_ADMIN" : "REJECTED" },
    include: { tontineSession: true },
  });

  return NextResponse.json({
    kind: "swap_request" as const,
    id: updated.id,
    requesterId: updated.requesterId,
    targetId: updated.targetId,
    status: updated.status,
    tontineType: updated.tontineSession.type,
    createdAt: updated.createdAt.toISOString(),
  });
}
