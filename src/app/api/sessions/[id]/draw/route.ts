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
            where: { status: "APPROVED" },
            select: { userId: true, slots: { select: { id: true, beneficiaryName: true, ballDrawn: true } } },
          },
        },
      });
      if (!tontineSession) {
        return { ok: false, status: 404, error: "Session not found" };
      }
      if (tontineSession.status !== "DRAWING") {
        return { ok: false, status: 409, error: "This session is not open for drawing" };
      }

      const myMembership = tontineSession.memberships.find((m) => m.userId === session.user.id);
      if (!myMembership) {
        return { ok: false, status: 403, error: "You are not an approved member of this session" };
      }
      const myUndrawnSlots = myMembership.slots.filter((s) => s.ballDrawn === null);
      if (myUndrawnSlots.length === 0) {
        return { ok: false, status: 409, error: "You have already drawn for all your slots" };
      }

      const allSlots = tontineSession.memberships.flatMap((m) => m.slots);
      const totalSlots = allSlots.length;
      const claimed = new Set(
        allSlots.map((s) => s.ballDrawn).filter((n): n is number => n !== null),
      );
      const pool = Array.from({ length: totalSlots }, (_, i) => i + 1).filter((n) => !claimed.has(n));
      if (pool.length < myUndrawnSlots.length) {
        return { ok: false, status: 409, error: "Not enough balls left to draw" };
      }

      const drawn: Array<{ slotId: string; beneficiaryName: string; ballDrawn: number }> = [];
      for (const slot of myUndrawnSlots) {
        const pickIndex = Math.floor(Math.random() * pool.length);
        const ballDrawn = pool.splice(pickIndex, 1)[0];
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
