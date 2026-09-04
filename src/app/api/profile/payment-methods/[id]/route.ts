import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  // deleteMany (not delete) scoped to userId too, not just id — a plain
  // delete-by-id would let a caller pass someone else's method id and
  // silently succeed against the wrong row before this check ever ran.
  const { count } = await prisma.savedPaymentMethod.deleteMany({
    where: { id, userId: session.user.id },
  });
  if (count === 0) {
    return NextResponse.json({ error: "Payer number not found" }, { status: 404 });
  }

  // If the deleted method was the default, promote the oldest remaining
  // one so there's always a sensible default once at least one exists —
  // never leave every saved number with isDefault: false.
  const remaining = await prisma.savedPaymentMethod.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, isDefault: true },
  });
  if (remaining.length > 0 && !remaining.some((m) => m.isDefault)) {
    await prisma.savedPaymentMethod.update({ where: { id: remaining[0].id }, data: { isDefault: true } });
  }

  return NextResponse.json({ ok: true });
}
