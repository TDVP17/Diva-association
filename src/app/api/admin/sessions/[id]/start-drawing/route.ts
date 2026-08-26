import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { isDrawUnlocked } from "@/lib/tontine-engine";

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
    if (!isDrawUnlocked(tontineSession.startDate)) {
      return NextResponse.json(
        { error: "The draw unlocks 24 hours before the cotisation's start date" },
        { status: 403 },
      );
    }

    await prisma.tontineSession.update({ where: { id }, data: { status: "DRAWING" } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[start-drawing] unexpected error:", err);
    return NextResponse.json({ error: "Could not start the drawing phase. Please try again." }, { status: 500 });
  }
}
