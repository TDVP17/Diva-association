import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

type DrawResult =
  | { ok: true; drawn: Array<{ slotId: string; beneficiaryName: string; ballDrawn: number }> }
  | { ok: false; status: number; error: string };

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: tontineSessionId } = await params;

  try {
    const result = await prisma.$transaction(async (tx): Promise<DrawResult> => {
      const tontineSession = await tx.tontineSession.findUnique({
        where: { id: tontineSessionId },
        include: {
          memberships: {
            where: { status: "APPROVED", userId: session.user.id },
            select: {
              userId: true,
              slots: { select: { id: true, beneficiaryName: true, ballDrawn: true, officialPosition: true } },
            },
          },
        },
      });
      if (!tontineSession) {
        return { ok: false, status: 404, error: "Session not found" };
      }
      if (tontineSession.status !== "DRAWING" && tontineSession.status !== "ACTIVE") {
        return { ok: false, status: 409, error: "This session is not open for drawing" };
      }

      const myMembership = tontineSession.memberships[0];
      if (!myMembership) {
        return { ok: false, status: 403, error: "You are not an approved member of this session" };
      }
      const myUndrawnSlots = myMembership.slots.filter((s) => s.ballDrawn === null);
      if (myUndrawnSlots.length === 0) {
        return { ok: false, status: 409, error: "You have already drawn for all your slots" };
      }
      if (myUndrawnSlots.some((s) => s.officialPosition === null)) {
        return { ok: false, status: 409, error: "Your position hasn't been assigned yet" };
      }

      // The draw animation is real, but it always reveals the admin's real,
      // already-assigned officialPosition — nothing here is randomized.
      const drawn: Array<{ slotId: string; beneficiaryName: string; ballDrawn: number }> = [];
      for (const slot of myUndrawnSlots) {
        const ballDrawn = slot.officialPosition!;
        await tx.membershipSlot.update({ where: { id: slot.id }, data: { ballDrawn } });
        drawn.push({ slotId: slot.id, beneficiaryName: slot.beneficiaryName, ballDrawn });
      }

      return { ok: true, drawn };
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ drawn: result.drawn });
  } catch (err) {
    console.error("[draw] unexpected error:", err);
    return NextResponse.json({ error: "Could not draw your ball. Please try again." }, { status: 500 });
  }
}
