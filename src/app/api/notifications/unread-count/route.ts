import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const count = await prisma.notification.count({
    where: { userId: session.user.id, status: { in: ["SENT", "FAILED"] }, readAt: null },
  });

  return NextResponse.json({ count });
}
