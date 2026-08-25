import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: tontineSessionId } = await params;

  try {
    const tontineSession = await prisma.tontineSession.findUnique({
      where: { id: tontineSessionId },
    });
    if (!tontineSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (tontineSession.status === "CLOSED") {
      return NextResponse.json(
        { error: "This session is closed and no longer accepting new members" },
        { status: 409 },
      );
    }

    const existing = await prisma.membership.findUnique({
      where: { userId_tontineSessionId: { userId: session.user.id, tontineSessionId } },
    });

    // Already pending or approved — nothing to do, just report the current state.
    if (existing && existing.status !== "REJECTED") {
      return NextResponse.json({ status: existing.status });
    }

    // No membership yet, or a prior rejection — (re)create as a fresh PENDING request.
    const membership = await prisma.membership.upsert({
      where: { userId_tontineSessionId: { userId: session.user.id, tontineSessionId } },
      create: { userId: session.user.id, tontineSessionId, status: "PENDING" },
      update: { status: "PENDING" },
    });

    return NextResponse.json({ status: membership.status });
  } catch (err) {
    console.error("[join] unexpected error:", err);
    return NextResponse.json(
      { error: "Could not submit your join request. Please try again." },
      { status: 500 },
    );
  }
}
