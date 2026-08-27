import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";

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

  const nextStatus = parsed.data.action === "accept" ? "PENDING_ADMIN" : "REJECTED";
  // Atomic, conditioned on the current status — the definitive guard
  // against two concurrent responses (or a stale double-tap) both
  // succeeding. The plain read above is only for the 404/403 checks; this
  // updateMany is what actually enforces the one-time state transition.
  const claimed = await prisma.positionSwapRequest.updateMany({
    where: { id, status: "PENDING_MEMBERSHIP" },
    data: { status: nextStatus },
  });
  if (claimed.count === 0) {
    return NextResponse.json({ error: "This request has already been resolved" }, { status: 409 });
  }

  const updated = await prisma.positionSwapRequest.findUniqueOrThrow({
    where: { id },
    include: { tontineSession: true },
  });

  if (parsed.data.action === "accept") {
    const admins = await prisma.user.findMany({
      where: { role: { in: ["ADMIN", "PRESIDENT"] } },
      select: { id: true },
    });
    await scheduleInAppNotifications({
      tontineSessionId: updated.tontineSessionId,
      type: "SWAP_REQUEST_PENDING_ADMIN",
      recipients: admins.map((a) => ({
        userId: a.id,
        message: "A position exchange has been accepted and is awaiting your approval.",
        actionUrl: "/admin/swap-requests",
      })),
    });
  }

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
