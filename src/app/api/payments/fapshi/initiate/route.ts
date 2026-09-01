import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { initiateSlotPayment } from "@/lib/initiate-slot-payment";

const bodySchema = z.object({
  membershipSlotId: z.string().min(1),
  phone: z.string().min(1),
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
  const { membershipSlotId, phone } = parsed.data;

  try {
    const slot = await prisma.membershipSlot.findUnique({
      where: { id: membershipSlotId },
      select: { membership: { select: { userId: true } } },
    });
    if (!slot || slot.membership.userId !== session.user.id) {
      return NextResponse.json({ error: "You don't own this slot" }, { status: 403 });
    }

    const result = await initiateSlotPayment(membershipSlotId, phone);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ transId: result.transId });
  } catch (err) {
    console.error("[fapshi/initiate] unexpected error:", err);
    return NextResponse.json({ error: "Payment initiation failed" }, { status: 500 });
  }
}
