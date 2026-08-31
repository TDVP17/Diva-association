import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { resolveUniqueSlotNames } from "@/lib/slot-naming";

const bodySchema = z.object({
  slotCount: z.coerce.number().int().min(1).max(5),
  beneficiaryNames: z.array(z.string().trim().min(1).max(100)).min(1).max(5),
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
    const membership = await prisma.membership.findUnique({
      where: { userId_tontineSessionId: { userId: session.user.id, tontineSessionId } },
    });
    if (!membership || membership.status !== "APPROVED") {
      return NextResponse.json({ error: "Your membership isn't approved yet" }, { status: 403 });
    }
    if (membership.slotCount !== null) {
      return NextResponse.json({ error: "You've already selected your slots" }, { status: 409 });
    }

    const existingSlots = await prisma.membershipSlot.findMany({
      where: { membership: { tontineSessionId } },
      select: { beneficiaryName: true },
    });
    const finalNames = resolveUniqueSlotNames(
      existingSlots.map((s) => s.beneficiaryName),
      beneficiaryNames,
    );

    await prisma.$transaction(async (tx) => {
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
