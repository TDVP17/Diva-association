import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import { logAudit } from "@/lib/audit";

const TONTINE_LABELS: Record<string, string> = {
  HEBDO_SUNDAY: "Weekly Tontine",
  MONTHLY_28: "Monthly Tontine (28th)",
  MONTHLY_25: "Monthly Tontine (25th)",
};

const broadcastSchema = z.object({
  target: z.enum(["ALL", "GROUP"]),
  tontineSessionId: z.string().optional(),
  title: z.string().trim().min(1, "Title is required").max(200),
  message: z.string().trim().min(1, "Message is required").max(5000),
});

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

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const json = await request.json().catch(() => null);
  const parsed = broadcastSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
  }

  const { target, tontineSessionId, title, message } = parsed.data;

  let userIds: string[] = [];

  if (target === "ALL") {
    const users = await prisma.user.findMany({
      where: { isBanned: false },
      select: { id: true },
    });
    userIds = users.map((u) => u.id);
  } else {
    if (!tontineSessionId) {
      return NextResponse.json({ error: "tontineSessionId is required for group alerts" }, { status: 400 });
    }

    const session = await prisma.tontineSession.findUnique({
      where: { id: tontineSessionId },
      select: { id: true, title: true, type: true },
    });
    if (!session) {
      return NextResponse.json({ error: "Cotisation group not found" }, { status: 404 });
    }

    const memberships = await prisma.membership.findMany({
      where: {
        tontineSessionId,
        status: "APPROVED",
      },
      select: { userId: true },
      distinct: ["userId"],
    });

    userIds = memberships.map((m) => m.userId);
  }

  if (userIds.length === 0) {
    return NextResponse.json({ ok: true, count: 0, message: "No recipients found" });
  }

  const actionUrl = target === "GROUP" && tontineSessionId ? `/sessions/${tontineSessionId}` : "/notifications";
  const formattedMessage = `${title}\n\n${message}`;

  const count = await scheduleInAppNotifications({
    tontineSessionId: target === "GROUP" ? tontineSessionId : undefined,
    type: "ADMIN_BROADCAST",
    recipients: userIds.map((userId) => ({
      userId,
      message: formattedMessage,
      actionUrl,
    })),
  });

  await logAudit({
    actorId: admin.user.id,
    actorRole: admin.user.role,
    action: "admin_broadcast_alert",
    targetType: target === "GROUP" ? "TontineSession" : "System",
    targetId: target === "GROUP" ? tontineSessionId! : "all_users",
    tontineSessionId: target === "GROUP" ? tontineSessionId : undefined,
    metadata: {
      target,
      title,
      count,
    },
    request,
  });

  return NextResponse.json({ ok: true, count });
}
