import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

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
      select: { id: true, status: true, startDate: true, validatedMembersCount: true },
    });

    if (!tontineSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const now = new Date();
    const hasStarted = tontineSession.status !== "DRAFT" || (tontineSession.startDate && tontineSession.startDate <= now);
    if (hasStarted) {
      return NextResponse.json(
        {
          error: "Impossible de quitter : la cotisation a déjà commencé.",
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
    if (slotIds.length > 0) {
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

      const hasPaid = await prisma.contribution.count({
        where: { membershipSlotId: { in: slotIds }, status: "PAID" },
      });
      if (hasPaid > 0) {
        return NextResponse.json(
          {
            error: "Impossible de quitter : des cotisations ont déjà été payées.",
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

      if (slotIds.length > 0) {
        // 2. Remove unpaid contributions and fines
        await tx.contribution.deleteMany({
          where: { membershipSlotId: { in: slotIds } },
        });
        await tx.fine.deleteMany({
          where: { membershipSlotId: { in: slotIds } },
        });

        // 3. Remove slots
        await tx.membershipSlot.deleteMany({ where: { membershipId: membership.id } });
      }

      // 4. Remove kyc verification for this session if any
      await tx.kycVerification.deleteMany({
        where: { userId, tontineSessionId },
      });

      // 5. Remove membership
      await tx.membership.delete({ where: { id: membership.id } });

      // 6. Decrement validatedMembersCount if it was > 0 so that member count decreases in all views
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
