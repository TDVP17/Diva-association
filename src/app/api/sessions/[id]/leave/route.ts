import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isSessionCycleFinished } from "@/lib/tontine-engine";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: tontineSessionId } = await params;
  const userId = session.user.id;

  try {
    const tontineSession = await prisma.tontineSession.findUnique({
      where: { id: tontineSessionId },
      select: { id: true, type: true, status: true, startDate: true, validatedMembersCount: true },
    });

    if (!tontineSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const now = new Date();

    const allSlots = await prisma.membershipSlot.findMany({
      where: { membership: { tontineSessionId: tontineSession.id, status: "APPROVED" } },
      select: { officialPosition: true },
    });

    const isFinished = isSessionCycleFinished({
      status: tontineSession.status,
      type: tontineSession.type,
      startDate: tontineSession.startDate,
      officialPositions: allSlots.map((s) => s.officialPosition),
      now,
    });

    const hasStarted = (tontineSession.status !== "DRAFT" || (tontineSession.startDate && tontineSession.startDate <= now)) && !isFinished;
    if (hasStarted) {
      return NextResponse.json(
        {
          error: "Impossible de quitter pendant qu'un cycle est en cours.",
          errorKey: "cannotLeaveOnceStarted",
        },
        { status: 409 },
      );
    }

    const membership = await prisma.membership.findUnique({
      where: { userId_tontineSessionId: { userId, tontineSessionId } },
      include: { slots: true },
    });

    if (!membership) {
      return NextResponse.json({ error: "Membership not found" }, { status: 404 });
    }

    const slotIds = membership.slots.map((s) => s.id);
    const hasPaid = slotIds.length > 0
      ? await prisma.contribution.count({
          where: { membershipSlotId: { in: slotIds }, status: "PAID" },
        })
      : 0;

    if (slotIds.length > 0 && !isFinished) {
      const hasDrawn = membership.slots.some((s) => s.ballDrawn !== null || s.officialPosition !== null);
      if (hasDrawn) {
        return NextResponse.json(
          {
            error: "Impossible de quitter : le tirage au sort a déjà eu lieu.",
            errorKey: "cannotLeaveOnceStarted",
          },
          { status: 409 },
        );
      }

      if (hasPaid > 0) {
        return NextResponse.json(
          {
            error: "Impossible de quitter : des cotisations ont déjà été payées pour ce cycle.",
            errorKey: "cannotLeaveOncePaid",
          },
          { status: 409 },
        );
      }
    }

    await prisma.$transaction(async (tx) => {
      // 1. Remove swap requests involving user if any
      await tx.positionSwapRequest.deleteMany({
        where: {
          tontineSessionId,
          OR: [{ requesterId: userId }, { targetId: userId }],
        },
      });

      if (hasPaid > 0) {
        // If member had paid contributions (leaving after a finished cycle),
        // remove only non-paid contributions and unpaid fines to preserve payment history & receipts
        if (slotIds.length > 0) {
          await tx.contribution.deleteMany({
            where: { membershipSlotId: { in: slotIds }, status: { not: "PAID" } },
          });
          await tx.fine.deleteMany({
            where: { membershipSlotId: { in: slotIds }, status: "UNPAID" },
          });
        }

        // Soft-remove membership by setting status to REJECTED so they aren't carried forward to next cycle
        await tx.membership.update({
          where: { id: membership.id },
          data: {
            status: "REJECTED",
            rejectionReason: "Member left the cotisation after cycle completion",
          },
        });
      } else {
        // Clean delete when no payment history exists (in DRAFT or no paid contributions)
        if (slotIds.length > 0) {
          await tx.contribution.deleteMany({
            where: { membershipSlotId: { in: slotIds } },
          });
          await tx.fine.deleteMany({
            where: { membershipSlotId: { in: slotIds } },
          });
          await tx.membershipSlot.deleteMany({ where: { membershipId: membership.id } });
        }

        await tx.kycVerification.deleteMany({
          where: { userId, tontineSessionId },
        });

        await tx.membership.delete({ where: { id: membership.id } });
      }

      // Decrement validatedMembersCount if it was > 0 so that member count decreases in all views
      if (
        membership.status === "APPROVED" &&
        tontineSession.validatedMembersCount &&
        tontineSession.validatedMembersCount > 0
      ) {
        await tx.tontineSession.update({
          where: { id: tontineSessionId },
          data: {
            validatedMembersCount: { decrement: 1 },
          },
        });
      }
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[sessions/leave] unexpected error:", err);
    return NextResponse.json({ error: "Could not leave the cotisation. Please try again." }, { status: 500 });
  }
}
