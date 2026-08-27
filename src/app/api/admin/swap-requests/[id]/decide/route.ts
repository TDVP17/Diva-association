import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";

const bodySchema = z.object({ action: z.enum(["approve", "reject"]) });

class SwapAlreadyResolvedError extends Error {}
class MissingSlotError extends Error {}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { id } = await params;
  const preCheck = await prisma.positionSwapRequest.findUnique({ where: { id } });
  if (!preCheck) {
    return NextResponse.json({ error: "Swap request not found" }, { status: 404 });
  }

  const nextStatus = parsed.data.action === "approve" ? ("APPROVED" as const) : ("REJECTED" as const);

  try {
    await prisma.$transaction(async (tx) => {
      // Atomically claim the row conditioned on its current status — this,
      // not the plain read above, is what actually prevents two concurrent
      // admin decisions (or an approve racing a reject) from both
      // proceeding. Claiming and the slot swap below happen in the same
      // transaction, so a second concurrent call blocks on the row lock
      // until this one commits, then sees count === 0.
      const claimed = await tx.positionSwapRequest.updateMany({
        where: { id, status: "PENDING_ADMIN" },
        data: { status: nextStatus },
      });
      if (claimed.count === 0) {
        throw new SwapAlreadyResolvedError();
      }

      if (parsed.data.action === "reject") return;

      // Position swaps are still a membership-level feature (not yet
      // redesigned for slots — see the schema's PositionSwapRequest note);
      // this swaps each membership's first slot as a representative stand-in.
      const [requesterMembership, targetMembership] = await Promise.all([
        tx.membership.findUnique({
          where: {
            userId_tontineSessionId: {
              userId: preCheck.requesterId,
              tontineSessionId: preCheck.tontineSessionId,
            },
          },
          include: { slots: { orderBy: { createdAt: "asc" }, take: 1 } },
        }),
        tx.membership.findUnique({
          where: {
            userId_tontineSessionId: {
              userId: preCheck.targetId,
              tontineSessionId: preCheck.tontineSessionId,
            },
          },
          include: { slots: { orderBy: { createdAt: "asc" }, take: 1 } },
        }),
      ]);
      const requesterSlot = requesterMembership?.slots[0];
      const targetSlot = targetMembership?.slots[0];
      if (!requesterSlot || !targetSlot) {
        throw new MissingSlotError();
      }

      await tx.membershipSlot.update({
        where: { id: requesterSlot.id },
        data: { officialPosition: targetSlot.officialPosition, ballDrawn: targetSlot.ballDrawn },
      });
      await tx.membershipSlot.update({
        where: { id: targetSlot.id },
        data: { officialPosition: requesterSlot.officialPosition, ballDrawn: requesterSlot.ballDrawn },
      });
    });
  } catch (err) {
    if (err instanceof SwapAlreadyResolvedError) {
      return NextResponse.json({ error: "This request is not awaiting admin approval" }, { status: 409 });
    }
    if (err instanceof MissingSlotError) {
      return NextResponse.json({ error: "One of the members has no registered slot" }, { status: 404 });
    }
    throw err;
  }

  await scheduleInAppNotifications({
    tontineSessionId: preCheck.tontineSessionId,
    type: nextStatus === "APPROVED" ? "SWAP_REQUEST_APPROVED" : "SWAP_REQUEST_REJECTED",
    recipients: [
      {
        userId: preCheck.requesterId,
        message:
          nextStatus === "APPROVED"
            ? "Your position exchange request was approved."
            : "Your position exchange request was rejected.",
        actionUrl: "/chat",
      },
      {
        userId: preCheck.targetId,
        message:
          nextStatus === "APPROVED"
            ? "A position exchange you accepted was approved."
            : "A position exchange you accepted was rejected.",
        actionUrl: "/chat",
      },
    ],
  });

  return NextResponse.json({ ok: true, status: nextStatus });
}
