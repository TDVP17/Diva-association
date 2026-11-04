import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getDesignatedSlot } from "@/lib/round-robin-lock";
import { getSessionActiveRoundAndDueDate } from "@/lib/tontine-engine";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";

const bodySchema = z.object({
  membershipSlotId: z.string().min(1),
  phone: z.string().trim().min(6).max(20),
  accountName: z.string().trim().min(1).max(200),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { membershipSlotId, phone, accountName } = parsed.data;

  const slot = await prisma.membershipSlot.findUnique({
    where: { id: membershipSlotId },
    include: {
      membership: {
        include: {
          tontineSession: {
            include: {
              payouts: {
                select: { dueDate: true, releasedAt: true, status: true },
              },
            },
          },
        },
      },
    },
  });
  if (!slot || slot.membership.userId !== session.user.id) {
    return NextResponse.json({ error: "Slot not found" }, { status: 404 });
  }

  if (slot.ballDrawn === null) {
    return NextResponse.json(
      { error: "You must pick your lucky ball before submitting payout details" },
      { status: 409 },
    );
  }

  const designatedSlot = await getDesignatedSlot(slot.membership.tontineSessionId);
  if (!designatedSlot || designatedSlot.id !== slot.id) {
    return NextResponse.json({ error: "It's not your turn yet" }, { status: 409 });
  }

  // Enforce rule: Payment information can ONLY be submitted once all members have contributed for this cycle
  const approvedMemberships = await prisma.membership.findMany({
    where: { tontineSessionId: slot.membership.tontineSessionId, status: "APPROVED" },
    include: { slots: true },
  });
  const allSlots = approvedMemberships.flatMap((m) => m.slots);
  const totalRegisteredSlots = approvedMemberships.reduce(
    (sum, m) => sum + (m.slotCount ? Number(m.slotCount) : 0),
    0,
  );
  const totalSlotsCount = totalRegisteredSlots > 0 ? totalRegisteredSlots : allSlots.length || 1;

  const releasedPayoutDates = (slot.membership.tontineSession.payouts ?? [])
    .filter((p) => p.releasedAt || p.status === "CONFIRMED" || p.status === "RELEASED")
    .map((p) => p.dueDate);

  const { dueDate } = getSessionActiveRoundAndDueDate({
    type: slot.membership.tontineSession.type,
    startDate: slot.membership.tontineSession.startDate,
    maxPosition: totalSlotsCount,
    releasedPayoutDates,
  });

  const targetDateStr = dueDate.toISOString().slice(0, 10);
  let paidContributionsCount = 0;

  if (prisma.contribution?.findMany) {
    const paidContributions = await prisma.contribution.findMany({
      where: {
        membershipSlotId: { in: allSlots.map((s) => s.id) },
        status: "PAID",
      },
      select: { membershipSlotId: true, dueDate: true },
    });
    const paidSlotIds = new Set(
      paidContributions
        .filter((c) => c.dueDate.toISOString().slice(0, 10) === targetDateStr)
        .map((c) => c.membershipSlotId),
    );
    paidContributionsCount = paidSlotIds.size;
  }

  if (paidContributionsCount === 0 && prisma.contribution?.count) {
    paidContributionsCount = await prisma.contribution.count({
      where: {
        membershipSlotId: { in: allSlots.map((s) => s.id) },
        dueDate,
        status: "PAID",
      },
    });
  }

  if (allSlots.length === 0 || paidContributionsCount < allSlots.length) {
    return NextResponse.json(
      { error: "Les coordonnées de paiement ne peuvent être transmises que lorsque tous les membres ont cotisé pour ce cycle." },
      { status: 409 },
    );
  }

  try {
    const payout = await prisma.payout.upsert({
      where: {
        tontineSessionId_dueDate: {
          tontineSessionId: slot.membership.tontineSessionId,
          dueDate,
        },
      },
      update: {
        membershipSlotId: slot.id,
        payoutPhone: phone,
        payoutAccountName: accountName,
        detailsSubmittedAt: new Date(),
      },
      create: {
        tontineSessionId: slot.membership.tontineSessionId,
        membershipSlotId: slot.id,
        dueDate,
        payoutPhone: phone,
        payoutAccountName: accountName,
      },
    });

    // Notify user in their notification center that their details were successfully submitted
    try {
      await scheduleInAppNotifications({
        tontineSessionId: slot.membership.tontineSessionId,
        type: "PAYOUT_TURN",
        recipients: [
          {
            userId: session.user.id,
            message:
              "Vos coordonnées de paiement ont été soumises. L'administrateur traitera votre virement sous peu.",
            actionUrl: `/sessions/${slot.membership.tontineSessionId}`,
          },
        ],
      });
    } catch (notifErr) {
      console.warn("[payout-claims] in-app notification dispatch failed:", notifErr);
    }

    return NextResponse.json({ ok: true, id: payout.id });
  } catch (err) {
    console.error("[payout-claims] unexpected error:", err);
    return NextResponse.json({ error: "Could not submit your payout details. Please try again." }, { status: 500 });
  }
}
