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
      select: { id: true, status: true },
    });

    if (!tontineSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (tontineSession.status !== "DRAFT") {
      return NextResponse.json(
        {
          error: "Impossible de quitter : le tirage au sort a déjà été lancé ou la cotisation est en cours.",
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

    await prisma.$transaction(async (tx) => {
      // Remove any slots
      await tx.membershipSlot.deleteMany({ where: { membershipId: membership.id } });
      // Remove membership
      await tx.membership.delete({ where: { id: membership.id } });
      // Remove kyc verification for this session if any
      await tx.kycVerification.deleteMany({
        where: { userId, tontineSessionId },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[sessions/leave] unexpected error:", err);
    return NextResponse.json({ error: "Could not leave the cotisation. Please try again." }, { status: 500 });
  }
}
