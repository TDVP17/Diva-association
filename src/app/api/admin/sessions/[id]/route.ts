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
    limitTime: s.limitTime,
    startDate: s.startDate.toISOString(),
    drawDate: s.drawDate ? s.drawDate.toISOString() : null,
    maxSlots: s.maxSlots ? Number(s.maxSlots) : null,
    isPaused: s.isPaused,
    lockedAt: s.lockedAt ? s.lockedAt.toISOString() : null,
    validatedMembersCount: s.validatedMembersCount ?? 0,
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
  startDate: z.coerce.date().optional(),
  limitTime: z.string().trim().min(1).max(100).optional(),
  maxSlots: z.coerce.number().positive().nullable().optional(),
  drawDate: z.coerce.date().optional(),
  status: z.enum(["DRAFT", "DRAWING", "ACTIVE", "CLOSED"]).optional(),
  validatedMembersCount: z.coerce.number().int().nonnegative().optional(),
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
    const before = await prisma.tontineSession.findUnique({ where: { id } });
    const after = await prisma.tontineSession.update({ where: { id }, data: parsed.data });
    await logAudit({
      actorId: admin.user.id,
      actorRole: admin.user.role,
      action: "contribution_updated",
      targetType: "TontineSession",
      targetId: id,
      tontineSessionId: id,
      metadata: JSON.parse(JSON.stringify(parsed.data)),
      payloadBefore: before ? JSON.parse(JSON.stringify(before)) : undefined,
      payloadAfter: JSON.parse(JSON.stringify(after)),
      request,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/sessions PATCH] unexpected error:", err);
    return NextResponse.json({ error: "Could not update the cotisation. Please try again." }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  try {
    const before = await prisma.tontineSession.findUnique({ where: { id } });
    if (!before) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Comprehensive cascading clean-up inside a transaction to ensure
    // no foreign keys, triggers, or child records ever block deletion:
    await prisma.$transaction(async (tx) => {
      // 1. Detach audit logs from this session so historical audit trail remains intact
      await tx.$executeRawUnsafe(
        `UPDATE "audit_logs" SET "tontineSessionId" = NULL WHERE "tontineSessionId" = $1`,
        id
      );

      // 2. Unlink any payment_attempts tied to contributions/fines of this session
      await tx.$executeRawUnsafe(
        `UPDATE "payment_attempts" SET "contributionId" = NULL, "fineId" = NULL 
         WHERE "contributionId" IN (
           SELECT c.id FROM "contributions" c
           JOIN "membership_slots" ms ON c."membershipSlotId" = ms.id
           JOIN "memberships" m ON ms."membershipId" = m.id
           WHERE m."tontineSessionId" = $1
         ) OR "fineId" IN (
           SELECT f.id FROM "fines" f
           JOIN "membership_slots" ms ON f."membershipSlotId" = ms.id
           JOIN "memberships" m ON ms."membershipId" = m.id
           WHERE m."tontineSessionId" = $1
         )`,
        id
      );

      // 3. Delete notifications & notification logs for this session
      await tx.$executeRawUnsafe(
        `DELETE FROM "notifications" WHERE "tontineSessionId" = $1`,
        id
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM "notification_logs" WHERE "tontineSessionId" = $1`,
        id
      );

      // 4. Delete turn reminders & food turn logs for slots belonging to this session
      await tx.$executeRawUnsafe(
        `DELETE FROM "turn_reminder_logs" WHERE "membershipSlotId" IN (
           SELECT ms.id FROM "membership_slots" ms
           JOIN "memberships" m ON ms."membershipId" = m.id
           WHERE m."tontineSessionId" = $1
         )`,
        id
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM "food_turn_logs" WHERE "membershipSlotId" IN (
           SELECT ms.id FROM "membership_slots" ms
           JOIN "memberships" m ON ms."membershipId" = m.id
           WHERE m."tontineSessionId" = $1
         )`,
        id
      );

      // 5. Delete payouts for this session
      await tx.$executeRawUnsafe(
        `DELETE FROM "payouts" WHERE "tontineSessionId" = $1`,
        id
      );

      // 6. Delete position swap requests for this session
      await tx.$executeRawUnsafe(
        `DELETE FROM "position_swap_requests" WHERE "tontineSessionId" = $1`,
        id
      );

      // 7. Delete contributions & fines for slots in this session
      await tx.$executeRawUnsafe(
        `DELETE FROM "contributions" WHERE "membershipSlotId" IN (
           SELECT ms.id FROM "membership_slots" ms
           JOIN "memberships" m ON ms."membershipId" = m.id
           WHERE m."tontineSessionId" = $1
         )`,
        id
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM "fines" WHERE "membershipSlotId" IN (
           SELECT ms.id FROM "membership_slots" ms
           JOIN "memberships" m ON ms."membershipId" = m.id
           WHERE m."tontineSessionId" = $1
         )`,
        id
      );

      // 8. Delete kyc_verifications linked to this session
      await tx.$executeRawUnsafe(
        `DELETE FROM "kyc_verifications" WHERE "tontineSessionId" = $1`,
        id
      );

      // 9. Delete membership slots and memberships
      await tx.$executeRawUnsafe(
        `DELETE FROM "membership_slots" WHERE "membershipId" IN (
           SELECT m.id FROM "memberships" m WHERE m."tontineSessionId" = $1
         )`,
        id
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM "memberships" WHERE "tontineSessionId" = $1`,
        id
      );

      // 10. Delete the tontine session itself
      await tx.tontineSession.delete({ where: { id } });
    });

    await logAudit({
      actorId: admin.user.id,
      actorRole: admin.user.role,
      action: "contribution_deleted",
      targetType: "TontineSession",
      targetId: id,
      payloadBefore: before ? JSON.parse(JSON.stringify(before)) : undefined,
      request,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/sessions DELETE] unexpected error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not delete the cotisation. Please try again." },
      { status: 500 }
    );
  }
}

