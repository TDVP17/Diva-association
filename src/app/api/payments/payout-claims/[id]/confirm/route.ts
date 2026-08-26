import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const payout = await prisma.payout.findUnique({
    where: { id },
    include: { membershipSlot: { include: { membership: true } } },
  });
  if (!payout || payout.membershipSlot.membership.userId !== session.user.id) {
    return NextResponse.json({ error: "Payout not found" }, { status: 404 });
  }
  if (payout.status !== "RELEASED") {
    return NextResponse.json({ error: "This payout hasn't been sent yet" }, { status: 409 });
  }

  await prisma.payout.update({
    where: { id },
    data: { status: "CONFIRMED", memberConfirmedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
