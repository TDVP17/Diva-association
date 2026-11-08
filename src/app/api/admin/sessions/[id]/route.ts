import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { logAudit } from "@/lib/audit";
import { getSessionActiveRoundAndDueDate, getSlotNextUnpaidDueDate } from "@/lib/tontine-engine";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const s = await prisma.tontineSession.findUnique({
    where: { id },
    include: {
      payouts: {
        select: { id: true, membershipSlotId: true, dueDate: true, status: true, releasedAt: true },
      },
      memberships: {
        where: { status: "APPROVED" },
        orderBy: { joinedAt: "asc" },
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

  const registeredSlots = s.memberships.reduce((sum, m) => sum + (m.slotCount ? Number(m.slotCount) : 0), 0);
  const allSlotIds = s.memberships.flatMap((m) => m.slots.map((sl) => sl.id));
  const totalSlotsCount = registeredSlots > 0 ? registeredSlots : allSlotIds.length || 1;

  const releasedPayoutDates = s.payouts
    .filter((p) => p.releasedAt || p.status === "CONFIRMED" || p.status === "RELEASED")
    .map((p) => p.dueDate);

  const { dueDate: sessionDueDate } = getSessionActiveRoundAndDueDate({
    type: s.type,
    startDate: s.startDate,
    maxPosition: totalSlotsCount,
    releasedPayoutDates,
  });

  const slotContributions = allSlotIds.length
    ? await prisma.contribution.findMany({
      where: { membershipSlotId: { in: allSlotIds } },
      select: {
        id: true,
        membershipSlotId: true,
        dueDate: true,
        status: true,
        proofImageUrl: true,
        proofImageUrls: true,
      },
    })
    : [];

  const sessionDueDateKey = sessionDueDate.toISOString().slice(0, 10);
  const paidSlotIds = new Set<string>();
  const pendingProofSlotIds = new Set<string>();

  for (const slotId of allSlotIds) {
    const rows = slotContributions.filter((c) => c.membershipSlotId === slotId);
    const paidRows = rows.filter((c) => c.status === "PAID");
    const nextUnpaid = getSlotNextUnpaidDueDate({
      type: s.type,
      startDate: s.startDate,
      maxPosition: totalSlotsCount,
      paidDueDates: paidRows.map((c) => c.dueDate),
    });
    const paidActiveCycle = paidRows.some((c) => c.dueDate.toISOString().slice(0, 10) === sessionDueDateKey);
    if (paidActiveCycle || nextUnpaid.isAllPaid) {
      paidSlotIds.add(slotId);
    }
    const hasPendingProof = rows.some(
      (c) => c.status !== "PAID" && Boolean(c.proofImageUrl || (c.proofImageUrls && c.proofImageUrls.length > 0)),
    );
    if (hasPendingProof) {
      pendingProofSlotIds.add(slotId);
    }
  }
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
    slots: s.memberships
      .flatMap((m) =>
        m.slots.map((slot) => {
          const slotPayout = s.payouts.find(
            (p) =>
              p.membershipSlotId === slot.id &&
              (p.status === "CONFIRMED" || p.status === "RELEASED" || Boolean(p.releasedAt)),
          );
          return {
            id: slot.id,
            membershipId: m.id,
            userId: m.userId,
            beneficiaryName: slot.beneficiaryName,
            name: m.user.name,
            phone: m.user.phone,
            memberCode: m.user.memberCode,
            avatar: m.user.avatar ?? m.user.image,
            hasPhone: !!m.user.phone,
            officialPosition: slot.officialPosition,
            ballDrawn: slot.ballDrawn,
            createdAt: slot.createdAt,
            paidThisCycle: paidSlotIds.has(slot.id),
            hasPendingProof: pendingProofSlotIds.has(slot.id),
            hasReceivedPayout: Boolean(slotPayout),
            payoutStatus: slotPayout?.status ?? "NONE",
            payoutId: slotPayout?.id ?? null,
          };
        }),
      )
      .sort((a, b) => {
        if (a.officialPosition !== null && b.officialPosition !== null) {
          return a.officialPosition - b.officialPosition;
        }
        if (a.officialPosition !== null) return -1;
        if (b.officialPosition !== null) return 1;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }),
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
      await tx.$executeRaw`UPDATE "audit_logs" SET "tontineSessionId" = NULL WHERE "tontineSessionId" = ${id}`;

      // 2. Unlink any payment_attempts tied to contributions/fines of this session
      await tx.$executeRaw`UPDATE "payment_attempts" SET "contributionId" = NULL, "fineId" = NULL 
         WHERE "contributionId" IN (
           SELECT c.id FROM "contributions" c
           JOIN "membership_slots" ms ON c."membershipSlotId" = ms.id
           JOIN "memberships" m ON ms."membershipId" = m.id
           WHERE m."tontineSessionId" = ${id}
         ) OR "fineId" IN (
           SELECT f.id FROM "fines" f
           JOIN "membership_slots" ms ON f."membershipSlotId" = ms.id
           JOIN "memberships" m ON ms."membershipId" = m.id
           WHERE m."tontineSessionId" = ${id}
         )`;

      // 3. Delete notifications & notification logs for this session
      await tx.$executeRaw`DELETE FROM "notifications" WHERE "tontineSessionId" = ${id}`;
      await tx.$executeRaw`DELETE FROM "notification_logs" WHERE "tontineSessionId" = ${id}`;

      // 4. Delete turn reminders & food turn logs for slots belonging to this session
      await tx.$executeRaw`DELETE FROM "turn_reminder_logs" WHERE "membershipSlotId" IN (
           SELECT ms.id FROM "membership_slots" ms
           JOIN "memberships" m ON ms."membershipId" = m.id
           WHERE m."tontineSessionId" = ${id}
         )`;
      await tx.$executeRaw`DELETE FROM "food_turn_logs" WHERE "membershipSlotId" IN (
           SELECT ms.id FROM "membership_slots" ms
           JOIN "memberships" m ON ms."membershipId" = m.id
           WHERE m."tontineSessionId" = ${id}
         )`;

      // 5. Delete payouts for this session
      await tx.$executeRaw`DELETE FROM "payouts" WHERE "tontineSessionId" = ${id}`;

      // 6. Delete position swap requests for this session
      await tx.$executeRaw`DELETE FROM "position_swap_requests" WHERE "tontineSessionId" = ${id}`;

      // 7. Delete contributions & fines for slots in this session
      await tx.$executeRaw`DELETE FROM "contributions" WHERE "membershipSlotId" IN (
           SELECT ms.id FROM "membership_slots" ms
           JOIN "memberships" m ON ms."membershipId" = m.id
           WHERE m."tontineSessionId" = ${id}
         )`;
      await tx.$executeRaw`DELETE FROM "fines" WHERE "membershipSlotId" IN (
           SELECT ms.id FROM "membership_slots" ms
           JOIN "memberships" m ON ms."membershipId" = m.id
           WHERE m."tontineSessionId" = ${id}
         )`;

      // 8. Delete kyc_verifications linked to this session
      await tx.$executeRaw`DELETE FROM "kyc_verifications" WHERE "tontineSessionId" = ${id}`;

      // 9. Delete membership slots and memberships
      await tx.$executeRaw`DELETE FROM "membership_slots" WHERE "membershipId" IN (
           SELECT m.id FROM "memberships" m WHERE m."tontineSessionId" = ${id}
         )`;
      await tx.$executeRaw`DELETE FROM "memberships" WHERE "tontineSessionId" = ${id}`;

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

