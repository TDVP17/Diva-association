import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

type DrawResult =
  | { ok: true; ballDrawn: number }
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
        include: { memberships: { select: { userId: true, status: true, ballDrawn: true } } },
      });
      if (!tontineSession) {
        return { ok: false, status: 404, error: "Session not found" };
      }
      if (tontineSession.status !== "DRAWING") {
        return { ok: false, status: 409, error: "This session is not open for drawing" };
      }

      const myMembership = tontineSession.memberships.find((m) => m.userId === session.user.id);
      if (!myMembership) {
        return { ok: false, status: 403, error: "You are not a member of this session" };
      }
      if (myMembership.status !== "APPROVED") {
        return { ok: false, status: 403, error: "Your membership for this session hasn't been approved yet" };
      }
      if (myMembership.ballDrawn !== null) {
        return { ok: false, status: 409, error: "You have already drawn your ball" };
      }

      const approvedMemberships = tontineSession.memberships.filter((m) => m.status === "APPROVED");
      const totalMembers = approvedMemberships.length;
      const claimed = new Set(
        approvedMemberships.map((m) => m.ballDrawn).filter((n): n is number => n !== null),
      );
      const pool = Array.from({ length: totalMembers }, (_, i) => i + 1).filter(
        (n) => !claimed.has(n),
      );
      if (pool.length === 0) {
        return { ok: false, status: 409, error: "No balls left to draw" };
      }

      const ballDrawn = pool[Math.floor(Math.random() * pool.length)];

      await tx.membership.update({
        where: { userId_tontineSessionId: { userId: session.user.id, tontineSessionId } },
        data: { ballDrawn },
      });

      return { ok: true, ballDrawn };
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ballDrawn: result.ballDrawn });
  } catch (err) {
    console.error("[draw] unexpected error:", err);
    return NextResponse.json({ error: "Could not draw your ball. Please try again." }, { status: 500 });
  }
}
