import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  try {
    const tontineSession = await prisma.tontineSession.findUnique({ where: { id } });
    if (!tontineSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (tontineSession.status !== "DRAFT") {
      return NextResponse.json({ error: "Only a draft cotisation can start its drawing phase" }, { status: 409 });
    }
    if (!tontineSession.drawDate || new Date() < tontineSession.drawDate) {
      return NextResponse.json(
        { error: "The draw is not unlocked yet — check the cotisation's draw date" },
        { status: 403 },
      );
    }

    await prisma.tontineSession.update({ where: { id }, data: { status: "DRAWING" } });

    const approvedMembers = await prisma.membership.findMany({
      where: { tontineSessionId: id, status: "APPROVED" },
      select: { userId: true },
    });
    await scheduleInAppNotifications({
      tontineSessionId: id,
      type: "DRAW_LAUNCHED",
      recipients: approvedMembers.map((m) => ({
        userId: m.userId,
        message: "The draw has started — come pick your number!",
        actionUrl: `/sessions/${id}/draw`,
      })),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[start-drawing] unexpected error:", err);
    return NextResponse.json({ error: "Could not start the drawing phase. Please try again." }, { status: 500 });
  }
}
