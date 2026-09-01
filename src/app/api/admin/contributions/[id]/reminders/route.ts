import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { getNextDueDate } from "@/lib/tontine-engine";
import { getUnpaidSlots } from "@/lib/notify";
import { translate } from "@/lib/i18n/translations";
import { scheduleNotifications } from "@/lib/notifications/dispatch";
import { logAudit } from "@/lib/audit";
import { formatXAF } from "@/lib/format-currency";

const TONTINE_LABELS: Record<string, string> = {
  HEBDO_SUNDAY: "Weekly Tontine",
  MONTHLY_28: "Monthly Tontine (28th)",
  MONTHLY_25: "Monthly Tontine (25th)",
};

const bodySchema = z.object({
  type: z.enum(["CONTRIBUTION_REMINDER", "FINE_REMINDER"]),
  channel: z.enum(["EMAIL", "WHATSAPP"]),
  memberIds: z.array(z.string().min(1)).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { id: tontineSessionId } = await params;
  const tontineSession = await prisma.tontineSession.findUnique({ where: { id: tontineSessionId } });
  if (!tontineSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const sessionLabel = tontineSession.title || TONTINE_LABELS[tontineSession.type];

  const recipients: { userId: string; message: string }[] = [];

  if (parsed.data.type === "CONTRIBUTION_REMINDER") {
    const dueDate = getNextDueDate(tontineSession.type, new Date());
    const unpaid = await getUnpaidSlots(tontineSessionId, dueDate);
    const seen = new Set<string>();
    for (const slot of unpaid) {
      if (parsed.data.memberIds && !parsed.data.memberIds.includes(slot.userId)) continue;
      if (seen.has(slot.userId)) continue; // one reminder per member, not per slot
      seen.add(slot.userId);
      const lang = slot.user.preferredLang === "fr" ? "fr" : "en";
      recipients.push({
        userId: slot.userId,
        message: translate(lang, "contributionReminderMessage", { name: slot.user.name, cotisation: sessionLabel }),
      });
    }
  } else {
    const fines = await prisma.fine.findMany({
      where: { membershipSlot: { membership: { tontineSessionId } }, status: "UNPAID" },
      include: { membershipSlot: { include: { membership: { include: { user: true } } } } },
    });
    const totalByUser = new Map<string, { amount: number; user: (typeof fines)[number]["membershipSlot"]["membership"]["user"] }>();
    for (const f of fines) {
      const userId = f.membershipSlot.membership.userId;
      if (parsed.data.memberIds && !parsed.data.memberIds.includes(userId)) continue;
      const existing = totalByUser.get(userId);
      totalByUser.set(userId, {
        amount: (existing?.amount ?? 0) + Number(f.amount),
        user: f.membershipSlot.membership.user,
      });
    }
    for (const [userId, { amount, user }] of totalByUser) {
      const lang = user.preferredLang === "fr" ? "fr" : "en";
      recipients.push({
        userId,
        message: translate(lang, "fineReminderMessage", { name: user.name, amount: formatXAF(amount) }),
      });
    }
  }

  const scheduled = await scheduleNotifications({
    tontineSessionId,
    channel: parsed.data.channel,
    type: parsed.data.type,
    recipients,
  });

  await logAudit({
    actorId: admin.user.id,
    actorRole: admin.user.role,
    action: "reminder_scheduled",
    targetType: "TontineSession",
    targetId: tontineSessionId,
    tontineSessionId,
    metadata: { type: parsed.data.type, channel: parsed.data.channel, count: scheduled },
    request,
  });

  return NextResponse.json({ scheduled });
}
