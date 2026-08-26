import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const notifications = await prisma.notification.findMany({
    where: { tontineSessionId: id },
    include: { user: { select: { name: true } } },
    orderBy: { scheduledAt: "desc" },
    take: 200,
  });

  return NextResponse.json({
    notifications: notifications.map((n) => ({
      id: n.id,
      userName: n.user.name,
      channel: n.channel,
      type: n.type,
      status: n.status,
      scheduledAt: n.scheduledAt.toISOString(),
      sentAt: n.sentAt ? n.sentAt.toISOString() : null,
      errorMessage: n.errorMessage,
    })),
  });
}
