import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const unreadNotifications = await prisma.notification.findMany({
    where: {
      userId: session.user.id,
      channel: "IN_APP",
      status: { in: ["SENT", "FAILED"] },
      readAt: null,
    },
    select: { type: true, tontineSessionId: true, messageKey: true, message: true },
  });

  const seen = new Set<string>();
  let count = 0;
  for (const n of unreadNotifications) {
    const key = `${n.type}-${n.tontineSessionId ?? "global"}-${n.messageKey ?? n.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      count++;
    }
  }

  return NextResponse.json({ count });
}
