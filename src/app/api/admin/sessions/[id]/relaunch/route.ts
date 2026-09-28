import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { logAudit } from "@/lib/audit";

const relaunchSchema = z.object({
  startDate: z.coerce.date(),
  drawDate: z.coerce.date().nullable().optional(),
  amount: z.coerce.number().positive().optional(),
  fee: z.coerce.number().nonnegative().optional(),
  maxSlots: z.coerce.number().positive().nullable().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = relaunchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { id } = await params;

  try {
    const existingSession = await prisma.tontineSession.findUnique({
      where: { id },
      include: {
        memberships: {
          where: { status: "APPROVED" },
          include: { slots: true },
        },
      },
    });

    if (!existingSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const { startDate, drawDate, amount, fee, maxSlots } = parsed.data;

    await prisma.$transaction(async (tx) => {
      const allSlotIds = existingSession.memberships.flatMap((m) => m.slots.map((s) => s.id));

      if (allSlotIds.length > 0) {
        // Clear prior cycle transactions for this session's slots
        await tx.contribution.deleteMany({ where: { membershipSlotId: { in: allSlotIds } } });
        await tx.fine.deleteMany({ where: { membershipSlotId: { in: allSlotIds } } });
        await tx.foodTurnLog.deleteMany({ where: { membershipSlotId: { in: allSlotIds } } });
        await tx.turnReminderLog.deleteMany({ where: { membershipSlotId: { in: allSlotIds } } });

        // Reset positions and ball drawn on slots for the new cycle
        await tx.membershipSlot.updateMany({
          where: { id: { in: allSlotIds } },
          data: { officialPosition: null, ballDrawn: null },
        });
      }

      await tx.payout.deleteMany({ where: { tontineSessionId: id } });
      await tx.positionSwapRequest.deleteMany({ where: { tontineSessionId: id } });

      // Unhide memberships for any member who hid the closed session
      await tx.membership.updateMany({
        where: { tontineSessionId: id, status: "APPROVED" },
        data: { hiddenByMemberAt: null },
      });

      // Reset the session back to DRAFT for the new cycle
      await tx.tontineSession.update({
        where: { id },
        data: {
          status: "DRAFT",
          startDate,
          drawDate: drawDate ?? null,
          isPaused: false,
          lockedAt: null,
          ...(amount ? { amount } : {}),
          ...(fee !== undefined ? { fee } : {}),
          ...(maxSlots !== undefined ? { maxSlots } : {}),
        },
      });

      // Notify existing approved members that the session has relaunched
      const sessionTitle = existingSession.title || existingSession.type;
      for (const m of existingSession.memberships) {
        await tx.notification.create({
          data: {
            userId: m.userId,
            tontineSessionId: id,
            channel: "IN_APP",
            type: "ADMIN_BROADCAST",
            message: `La cotisation "${sessionTitle}" a été relancée pour un nouveau cycle ! Vous pouvez confirmer, ajuster vos noms ou quitter la cotisation si vous le souhaitez.`,
            messageKey: "sessionRelaunchedNotification",
            messageVars: { session: sessionTitle },
            status: "SENT",
            readAt: null,
            actionUrl: `/sessions/${id}`,
          },
        });
      }
    });

    await logAudit({
      actorId: admin.user.id,
      actorRole: admin.user.role,
      action: "cotisation_relaunched",
      targetType: "TontineSession",
      targetId: id,
      tontineSessionId: id,
      metadata: { newStartDate: startDate.toISOString() },
      request,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/sessions relaunch] error:", err);
    return NextResponse.json({ error: "Could not relaunch the cotisation" }, { status: 500 });
  }
}
