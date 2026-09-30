import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const notification = await prisma.notification.findUnique({
    where: { id },
    select: { userId: true, type: true, tontineSessionId: true, message: true },
  });
  if (!notification || notification.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Delete this notification and any duplicate rows
  await prisma.notification.deleteMany({
    where: {
      userId: session.user.id,
      type: notification.type,
      tontineSessionId: notification.tontineSessionId,
      message: notification.message,
    },
  });
  return NextResponse.json({ ok: true });
}
