import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";

const TONTINE_LABELS: Record<string, string> = {
  HEBDO_SUNDAY: "Weekly Tontine",
  MONTHLY_28: "Monthly Tontine (28th)",
  MONTHLY_25: "Monthly Tontine (25th)",
};

const PAGE_SIZE = 50;

export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(request.url);
  const tontineSessionId = url.searchParams.get("tontineSessionId") ?? undefined;
  const channel = url.searchParams.get("channel") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;
  const memberQuery = url.searchParams.get("member")?.trim() ?? undefined;

  const where = {
    ...(tontineSessionId ? { tontineSessionId } : {}),
    ...(channel ? { channel: channel as "EMAIL" | "WHATSAPP" | "IN_APP" } : {}),
    ...(status ? { status: status as "PENDING" | "SCHEDULED" | "PROCESSING" | "SENT" | "FAILED" } : {}),
    ...(memberQuery ? { user: { name: { contains: memberQuery, mode: "insensitive" as const } } } : {}),
  };

  const [notifications, sessions] = await Promise.all([
    prisma.notification.findMany({
      where,
      include: { user: { select: { name: true } }, tontineSession: { select: { id: true, title: true, type: true } } },
      orderBy: { scheduledAt: "desc" },
      take: PAGE_SIZE,
    }),
    prisma.tontineSession.findMany({ select: { id: true, title: true, type: true }, orderBy: { startDate: "desc" } }),
  ]);

  return NextResponse.json({
    notifications: notifications.map((n) => ({
      id: n.id,
      userName: n.user.name,
      contributionLabel: n.tontineSession
        ? n.tontineSession.title || TONTINE_LABELS[n.tontineSession.type]
        : null,
      channel: n.channel,
      type: n.type,
      actionUrl: n.actionUrl,
      status: n.status,
      scheduledAt: n.scheduledAt.toISOString(),
      sentAt: n.sentAt ? n.sentAt.toISOString() : null,
      errorMessage: n.errorMessage,
    })),
    contributions: sessions.map((s) => ({
      id: s.id,
      label: s.title || TONTINE_LABELS[s.type],
    })),
  });
}
