import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const method = await prisma.savedPaymentMethod.findUnique({ where: { id } });
  if (!method || method.userId !== session.user.id) {
    return NextResponse.json({ error: "Payer number not found" }, { status: 404 });
  }

  await prisma.$transaction([
    prisma.savedPaymentMethod.updateMany({
      where: { userId: session.user.id, isDefault: true },
      data: { isDefault: false },
    }),
    prisma.savedPaymentMethod.update({ where: { id }, data: { isDefault: true } }),
  ]);

  return NextResponse.json({ ok: true });
}
