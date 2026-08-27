import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { assertJoinable, sumRegisteredSlots } from "@/lib/session-joinability";
import { createVerificationSession, DiditError } from "@/lib/didit";
import { isAdminRole } from "@/lib/constants";

const bodySchema = z.object({ documentType: z.enum(["CNI", "PASSPORT"]) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (isAdminRole(session.user.role)) {
    return NextResponse.json({ error: "Admin accounts cannot join tontine sessions" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { id: tontineSessionId } = await params;

  try {
    const tontineSession = await prisma.tontineSession.findUnique({
      where: { id: tontineSessionId },
      include: { memberships: { select: { status: true, slotCount: true } } },
    });
    if (!tontineSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const joinable = assertJoinable(
      { ...tontineSession, maxSlots: tontineSession.maxSlots ? Number(tontineSession.maxSlots) : null },
      sumRegisteredSlots(tontineSession.memberships),
    );
    if (!joinable.ok) {
      return NextResponse.json({ error: joinable.error }, { status: joinable.status });
    }

    const existingMembership = await prisma.membership.findUnique({
      where: { userId_tontineSessionId: { userId: session.user.id, tontineSessionId } },
    });
    if (existingMembership && existingMembership.status !== "REJECTED") {
      return NextResponse.json({ status: existingMembership.status });
    }

    const origin = new URL(request.url).origin;
    let result;
    try {
      result = await createVerificationSession({
        vendorData: session.user.id,
        callback: `${origin}/sessions/${tontineSessionId}`,
      });
    } catch (err) {
      if (err instanceof DiditError) {
        // Never forward Didit's raw error text to the user (e.g. "Didit
        // session creation failed") — log it for diagnosis, show a plain
        // bilingual message instead.
        console.error("[sessions/kyc] Didit error:", err.status, err.message);
        return NextResponse.json(
          { error: "Verification could not start. Please try again." },
          { status: 502 },
        );
      }
      throw err;
    }

    await prisma.kycVerification.create({
      data: {
        userId: session.user.id,
        tontineSessionId,
        documentType: parsed.data.documentType,
        status: "PENDING",
        diditSessionId: result.session_id,
      },
    });

    return NextResponse.json({ verificationUrl: result.url });
  } catch (err) {
    console.error("[sessions/kyc] unexpected error:", err);
    return NextResponse.json(
      { error: "Could not start identity verification. Please try again." },
      { status: 500 },
    );
  }
}
