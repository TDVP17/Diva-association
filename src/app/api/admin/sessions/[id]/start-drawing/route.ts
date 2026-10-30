import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const payload = await request.json().catch(() => ({}));
  const submittedOrder: string[] | undefined = Array.isArray(payload?.order) ? payload.order : undefined;
  const firstPlaceSlotId: string | undefined = typeof payload?.firstPlaceSlotId === "string" ? payload.firstPlaceSlotId : undefined;

  try {
    const tontineSession = await prisma.tontineSession.findUnique({
      where: { id },
      include: {
        memberships: {
          where: { status: "APPROVED" },
          include: { slots: true },
        },
      },
    });
    if (!tontineSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (tontineSession.status !== "DRAFT") {
      return NextResponse.json({ error: "Only a draft cotisation can start its drawing phase" }, { status: 409 });
    }

    const now = new Date();
    // Update status to DRAWING and ensure drawDate is active
    await prisma.tontineSession.update({
      where: { id },
      data: {
        status: "DRAWING",
        drawDate: !tontineSession.drawDate || now < tontineSession.drawDate ? now : undefined,
      },
    });

    const allSlots = tontineSession.memberships.flatMap((m) => m.slots);
    const existingSlotIds = new Set(allSlots.map((s) => s.id));

    if (submittedOrder && submittedOrder.length > 0) {
      // Explicit order specified by admin
      const validOrder = submittedOrder.filter((sid) => existingSlotIds.has(sid));
      const submittedSet = new Set(validOrder);
      const remainingSlots = allSlots.filter((s) => !submittedSet.has(s.id));
      const fullOrder = [...validOrder, ...remainingSlots.map((s) => s.id)];

      await prisma.$transaction(
        fullOrder.map((slotId, idx) =>
          prisma.membershipSlot.update({
            where: { id: slotId },
            data: { officialPosition: idx + 1 },
          }),
        ),
      );
    } else if (firstPlaceSlotId && existingSlotIds.has(firstPlaceSlotId)) {
      // Admin selected first place
      const otherSlots = allSlots.filter((s) => s.id !== firstPlaceSlotId);
      const shuffledOthers = otherSlots.sort(() => Math.random() - 0.5);
      const fullOrder = [firstPlaceSlotId, ...shuffledOthers.map((s) => s.id)];

      await prisma.$transaction(
        fullOrder.map((slotId, idx) =>
          prisma.membershipSlot.update({
            where: { id: slotId },
            data: { officialPosition: idx + 1 },
          }),
        ),
      );
    } else {
      // Preserve any already assigned positions, only shuffle unassigned slots
      const unassigned = allSlots.filter((s) => s.officialPosition === null);
      if (unassigned.length > 0) {
        const takenPositions = new Set(
          allSlots.map((s) => s.officialPosition).filter((p): p is number => p !== null),
        );
        const availablePositions: number[] = [];
        for (let i = 1; i <= allSlots.length; i++) {
          if (!takenPositions.has(i)) availablePositions.push(i);
        }
        const shuffled = availablePositions.sort(() => Math.random() - 0.5);
        await prisma.$transaction(
          unassigned.map((slot, idx) =>
            prisma.membershipSlot.update({
              where: { id: slot.id },
              data: { officialPosition: shuffled[idx] },
            }),
          ),
        );
      }
    }

    const approvedMembers = await prisma.membership.findMany({
      where: { tontineSessionId: id, status: "APPROVED" },
      select: { userId: true },
    });
    await scheduleInAppNotifications({
      tontineSessionId: id,
      type: "DRAW_LAUNCHED",
      recipients: approvedMembers.map((m) => ({
        userId: m.userId,
        message: "The draw has started — come pick your number!",
        messageKey: "drawStartedMessage",
        actionUrl: `/sessions/${id}/draw`,
      })),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[start-drawing] unexpected error:", err);
    return NextResponse.json({ error: "Could not start the drawing phase. Please try again." }, { status: 500 });
  }
}
