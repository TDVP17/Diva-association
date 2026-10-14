import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

type DrawResult =
  | {
      ok: true;
      drawn: Array<{ slotId: string; beneficiaryName: string; ballDrawn: number }>;
      remainingUndrawnCount: number;
      nextSlotName: string | null;
    }
  | { ok: false; status: number; error: string };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: tontineSessionId } = await params;
  const payload = await request.json().catch(() => ({}));
  const requestedSlotId = typeof payload?.slotId === "string" ? payload.slotId : null;

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

      // Draw ONE slot at a time as requested:
      // "Et pour celui qui a plusieurs noms, il doit selections les boules pour chaque noms."
      const slotToDraw = requestedSlotId
        ? myUndrawnSlots.find((s) => s.id === requestedSlotId) ?? myUndrawnSlots[0]
        : myUndrawnSlots[0];

      const ballDrawn = slotToDraw.officialPosition!;
      await tx.membershipSlot.update({ where: { id: slotToDraw.id }, data: { ballDrawn } });
      const drawn = [{ slotId: slotToDraw.id, beneficiaryName: slotToDraw.beneficiaryName, ballDrawn }];

      const remainingUndrawnCount = myUndrawnSlots.length - 1;
      const nextUndrawnSlot = myUndrawnSlots.find((s) => s.id !== slotToDraw.id) ?? null;

      return {
        ok: true,
        drawn,
        remainingUndrawnCount,
        nextSlotName: nextUndrawnSlot?.beneficiaryName ?? null,
      };
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({
      drawn: result.drawn,
      remainingUndrawnCount: result.remainingUndrawnCount,
      nextSlotName: result.nextSlotName,
    });
  } catch (err) {
    console.error("[draw] unexpected error:", err);
    return NextResponse.json({ error: "Could not draw your ball. Please try again." }, { status: 500 });
  }
}
