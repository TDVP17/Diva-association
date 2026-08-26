import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { logAudit } from "@/lib/audit";
import { getNextDueDate } from "@/lib/tontine-engine";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const s = await prisma.tontineSession.findUnique({
    where: { id },
    include: {
      memberships: {
        where: { status: "APPROVED" },
        include: {
          user: { select: { id: true, name: true, avatar: true, image: true, phone: true, memberCode: true } },
          slots: { orderBy: [{ officialPosition: "asc" }, { ballDrawn: "asc" }, { createdAt: "asc" }] },
        },
      },
    },
  });
  if (!s) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const dueDate = getNextDueDate(s.type, new Date());
  const allSlotIds = s.memberships.flatMap((m) => m.slots.map((sl) => sl.id));
  const paidContributions = allSlotIds.length
    ? await prisma.contribution.findMany({
        where: { membershipSlotId: { in: allSlotIds }, dueDate, status: "PAID" },
        select: { membershipSlotId: true },
      })
    : [];
  const paidSlotIds = new Set(paidContributions.map((c) => c.membershipSlotId));

  const registeredSlots = s.memberships.reduce((sum, m) => sum + (m.slotCount ? Number(m.slotCount) : 0), 0);
  return NextResponse.json({
    id: s.id,
    title: s.title,
    description: s.description,
    type: s.type,
    status: s.status,
    amount: Number(s.amount),
    fee: Number(s.fee),
    fineAmountPerPeriod: s.fineAmountPerPeriod ? Number(s.fineAmountPerPeriod) : null,
    fineIntervalHours: s.fineIntervalHours,
    rules: s.rules,
    limitTime: s.limitTime,
    startDate: s.startDate.toISOString(),
    drawDate: s.drawDate ? s.drawDate.toISOString() : null,
    maxSlots: s.maxSlots ? Number(s.maxSlots) : null,
    isPaused: s.isPaused,
    lockedAt: s.lockedAt ? s.lockedAt.toISOString() : null,
    registeredSlots,
    slots: s.memberships.flatMap((m) =>
      m.slots.map((slot) => ({
        id: slot.id,
        membershipId: m.id,
        userId: m.userId,
        beneficiaryName: slot.beneficiaryName,
        name: m.user.name,
        memberCode: m.user.memberCode,
        avatar: m.user.avatar ?? m.user.image,
        hasPhone: !!m.user.phone,
        officialPosition: slot.officialPosition,
        ballDrawn: slot.ballDrawn,
        paidThisCycle: paidSlotIds.has(slot.id),
      })),
    ),
  });
}

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(5000).optional(),
  amount: z.coerce.number().positive().optional(),
  fee: z.coerce.number().nonnegative().optional(),
  fineAmountPerPeriod: z.coerce.number().nonnegative().optional(),
  fineIntervalHours: z.coerce.number().int().positive().optional(),
  rules: z.string().trim().max(5000).optional(),
  startDate: z.coerce.date().optional(),
  limitTime: z.string().trim().min(1).max(100).optional(),
  maxSlots: z.coerce.number().positive().nullable().optional(),
  drawDate: z.coerce.date().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { id } = await params;
  try {
    await prisma.tontineSession.update({ where: { id }, data: parsed.data });
    await logAudit({
      actorId: admin.user.id,
      action: "contribution_updated",
      targetType: "TontineSession",
      targetId: id,
      tontineSessionId: id,
      metadata: JSON.parse(JSON.stringify(parsed.data)),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/sessions PATCH] unexpected error:", err);
    return NextResponse.json({ error: "Could not update the cotisation. Please try again." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const [contributionCount, fineCount, payoutCount] = await Promise.all([
    prisma.contribution.count({ where: { membershipSlot: { membership: { tontineSessionId: id } } } }),
    prisma.fine.count({ where: { membershipSlot: { membership: { tontineSessionId: id } } } }),
    prisma.payout.count({ where: { tontineSessionId: id } }),
  ]);
  if (contributionCount > 0 || fineCount > 0 || payoutCount > 0) {
    return NextResponse.json(
      { error: "This cotisation has payment history — use Lock instead of Delete." },
      { status: 409 },
    );
  }

  try {
    await prisma.tontineSession.delete({ where: { id } });
    await logAudit({ actorId: admin.user.id, action: "contribution_deleted", targetType: "TontineSession", targetId: id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/sessions DELETE] unexpected error:", err);
    return NextResponse.json({ error: "Could not delete the cotisation. Please try again." }, { status: 500 });
  }
}
