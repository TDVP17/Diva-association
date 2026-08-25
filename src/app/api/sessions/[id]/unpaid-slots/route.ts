import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getNextDueDate } from "@/lib/tontine-engine";

// Public, no-auth route — only ever returns { id, beneficiaryName } pairs,
// nothing about the owning member (no phone/email/personal data), since
// this feeds the anonymous third-party payment page.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: tontineSessionId } = await params;

  try {
    const tontineSession = await prisma.tontineSession.findUnique({ where: { id: tontineSessionId } });
    if (!tontineSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const dueDate = getNextDueDate(tontineSession.type, new Date());

    const slots = await prisma.membershipSlot.findMany({
      where: { membership: { tontineSessionId, status: "APPROVED" } },
      select: {
        id: true,
        beneficiaryName: true,
        contributions: { where: { dueDate }, select: { status: true } },
      },
    });

    const unpaid = slots
      .filter((s) => s.contributions[0]?.status !== "PAID")
      .map((s) => ({ id: s.id, beneficiaryName: s.beneficiaryName }));

    return NextResponse.json({ slots: unpaid, sessionTitle: tontineSession.title });
  } catch (err) {
    console.error("[unpaid-slots] unexpected error:", err);
    return NextResponse.json({ error: "Could not load the unpaid list" }, { status: 500 });
  }
}
