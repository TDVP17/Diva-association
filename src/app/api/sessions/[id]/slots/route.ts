import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { resolveUniqueSlotNames } from "@/lib/slot-naming";

const bodySchema = z.object({
  slotCount: z.coerce.number().int().min(1).max(10),
  beneficiaryNames: z.array(z.string().trim().min(1).max(100)).min(1).max(10),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { id: tontineSessionId } = await params;
  const { slotCount, beneficiaryNames } = parsed.data;

  if (beneficiaryNames.length !== slotCount) {
    return NextResponse.json(
      { error: `Please provide exactly ${slotCount} name(s)` },
      { status: 400 },
    );
  }

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
        { error: "Cannot modify slots once drawing or payments have started" },
        { status: 409 },
      );
    }

    const membership = await prisma.membership.findUnique({
      where: { userId_tontineSessionId: { userId: session.user.id, tontineSessionId } },
    });
    if (!membership || membership.status !== "APPROVED") {
      return NextResponse.json({ error: "Your membership isn't approved yet" }, { status: 403 });
    }

    const existingSlots = await prisma.membershipSlot.findMany({
      where: {
        membership: { tontineSessionId },
        NOT: { membershipId: membership.id },
      },
      select: { beneficiaryName: true },
    });
    const finalNames = resolveUniqueSlotNames(
      existingSlots.map((s) => s.beneficiaryName),
      beneficiaryNames,
    );

    await prisma.$transaction(async (tx) => {
      // Delete previous slots if member is adjusting (increasing/decreasing) names
      await tx.membershipSlot.deleteMany({
        where: { membershipId: membership.id },
      });

      await tx.membership.update({
        where: { id: membership.id },
        data: { slotCount },
      });

      await tx.membershipSlot.createMany({
        data: finalNames.map((beneficiaryName) => ({
          membershipId: membership.id,
          beneficiaryName,
        })),
      });
    });

    return NextResponse.json({ ok: true, beneficiaryNames: finalNames });
  } catch (err) {
    console.error("[sessions/slots] unexpected error:", err);
    return NextResponse.json(
      { error: "Could not save your slots. Please try again." },
      { status: 500 },
    );
  }
}
