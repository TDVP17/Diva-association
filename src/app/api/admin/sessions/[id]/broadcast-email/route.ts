import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { scheduleNotifications } from "@/lib/notifications/dispatch";
import { logAudit } from "@/lib/audit";

const bodySchema = z.object({
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
});

// Routes through the Notification queue (5-minute stagger, survives the
// admin closing their browser) instead of a synchronous send loop — same
// recipient selection as before, just non-blocking and tracked now.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { id: tontineSessionId } = await params;

  const memberships = await prisma.membership.findMany({
    where: { tontineSessionId, status: "APPROVED" },
    select: { userId: true },
    distinct: ["userId"],
  });

  const scheduled = await scheduleNotifications({
    tontineSessionId,
    channel: "EMAIL",
    type: "ADMIN_BROADCAST",
    recipients: memberships.map((m) => ({ userId: m.userId, message: `${parsed.data.subject}\n\n${parsed.data.body}` })),
  });

  await logAudit({
    actorId: admin.user.id,
    action: "admin_broadcast_scheduled",
    targetType: "TontineSession",
    targetId: tontineSessionId,
    tontineSessionId,
    metadata: { subject: parsed.data.subject, count: scheduled },
  });

  return NextResponse.json({ scheduled });
}
