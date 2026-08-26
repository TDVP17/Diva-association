import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getDesignatedSlot } from "@/lib/round-robin-lock";
import { getMostRecentDueDate } from "@/lib/tontine-engine";

const bodySchema = z.object({
  membershipSlotId: z.string().min(1),
  phone: z.string().trim().min(6).max(20),
  accountName: z.string().trim().min(1).max(200),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { membershipSlotId, phone, accountName } = parsed.data;

  const slot = await prisma.membershipSlot.findUnique({
    where: { id: membershipSlotId },
    include: { membership: { include: { tontineSession: true } } },
  });
  if (!slot || slot.membership.userId !== session.user.id) {
    return NextResponse.json({ error: "Slot not found" }, { status: 404 });
  }

  const designatedSlot = await getDesignatedSlot(slot.membership.tontineSessionId);
  if (!designatedSlot || designatedSlot.id !== slot.id) {
    return NextResponse.json({ error: "It's not your turn yet" }, { status: 409 });
  }

  const dueDate = getMostRecentDueDate(slot.membership.tontineSession.type, new Date());

  try {
    const payout = await prisma.payout.create({
      data: {
        tontineSessionId: slot.membership.tontineSessionId,
        membershipSlotId: slot.id,
        dueDate,
        payoutPhone: phone,
        payoutAccountName: accountName,
      },
    });
    return NextResponse.json({ ok: true, id: payout.id });
  } catch (err) {
    console.error("[payout-claims] unexpected error:", err);
    return NextResponse.json({ error: "Could not submit your payout details. Please try again." }, { status: 500 });
  }
}
