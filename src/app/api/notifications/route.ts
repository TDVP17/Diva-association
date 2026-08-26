import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const TONTINE_LABELS: Record<string, string> = {
  HEBDO_SUNDAY: "Weekly Tontine",
  MONTHLY_28: "Monthly Tontine (28th)",
  MONTHLY_25: "Monthly Tontine (25th)",
};

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const notifications = await prisma.notification.findMany({
    where: { userId: session.user.id, status: { in: ["SENT", "FAILED"] } },
    include: { tontineSession: { select: { title: true, type: true } } },
    orderBy: { sentAt: "desc" },
    take: 100,
  });

  return NextResponse.json({
    notifications: notifications.map((n) => ({
      id: n.id,
      type: n.type,
      message: n.message,
      contributionLabel: n.tontineSession
        ? n.tontineSession.title || TONTINE_LABELS[n.tontineSession.type]
        : null,
      sentAt: (n.sentAt ?? n.scheduledAt).toISOString(),
      readAt: n.readAt ? n.readAt.toISOString() : null,
    })),
  });
}
