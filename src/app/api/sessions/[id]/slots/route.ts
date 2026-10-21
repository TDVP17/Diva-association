import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { resolveUniqueSlotNames } from "@/lib/slot-naming";
import { isSessionCycleFinished } from "@/lib/tontine-engine";

const bodySchema = z.object({
  slotCount: z.coerce.number().int().min(1).max(10),
  beneficiaryNames: z.array(z.string().trim().min(1).max(100)).min(1).max(10),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { id: tontineSessionId } = await params;
  const { slotCount, beneficiaryNames } = parsed.data;

  if (beneficiaryNames.length !== slotCount) {
    return NextResponse.json(
      { error: `Please provide exactly ${slotCount} name(s)` },
      { status: 400 },
    );
  }

  try {
    const tontineSession = await prisma.tontineSession.findUnique({
      where: { id: tontineSessionId },
      include: {
        memberships: {
          select: { id: true, status: true, slotCount: true },
        },
      },
    });
    if (!tontineSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const allSlots = await prisma.membershipSlot.findMany({
      where: { membership: { tontineSessionId: tontineSession.id, status: "APPROVED" } },
      select: { officialPosition: true },
    });

    const isFinished = isSessionCycleFinished({
      status: tontineSession.status,
      type: tontineSession.type,
      startDate: tontineSession.startDate,
      officialPositions: allSlots.map((s) => s.officialPosition),
    });

    if (tontineSession.status !== "DRAFT" && !isFinished) {
      return NextResponse.json(
        { error: "Cannot modify slots while cotisation cycle is actively running" },
        { status: 409 },
      );
    }

    const membership = await prisma.membership.findUnique({
      where: { userId_tontineSessionId: { userId: session.user.id, tontineSessionId } },
    });
    if (!membership || membership.status !== "APPROVED") {
      return NextResponse.json({ error: "Your membership isn't approved yet" }, { status: 403 });
    }

    if (tontineSession.maxSlots !== null) {
      const maxAllowed = Number(tontineSession.maxSlots);
      const otherSlotsTotal = tontineSession.memberships
        .filter((m) => m.status === "APPROVED" && m.id !== membership.id)
        .reduce((sum, m) => sum + (m.slotCount ? Number(m.slotCount) : 0), 0);
      const remainingSlots = Math.max(0, maxAllowed - otherSlotsTotal);

      if (slotCount > remainingSlots) {
        return NextResponse.json(
          {
            error:
              remainingSlots === 0
                ? "Cette cotisation a atteint sa capacité maximale."
                : `Il ne reste que ${remainingSlots} place(s) disponible(s) dans cette cotisation. Vous ne pouvez pas enregistrer ${slotCount} nom(s).`,
          },
          { status: 409 },
        );
      }
    }

    const existingSlots = await prisma.membershipSlot.findMany({
      where: {
        membership: { tontineSessionId },
        NOT: { membershipId: membership.id },
      },
      select: { beneficiaryName: true },
    });
    const finalNames = resolveUniqueSlotNames(
      existingSlots.map((s) => s.beneficiaryName),
      beneficiaryNames,
    );

    await prisma.$transaction(async (tx) => {
      const existingUserSlots = await tx.membershipSlot.findMany({
        where: { membershipId: membership.id },
        orderBy: { createdAt: "asc" },
      });

      // Update existing slots with the new beneficiary names in place
      const slotsToUpdate = existingUserSlots.slice(0, finalNames.length);
      for (let i = 0; i < slotsToUpdate.length; i++) {
        await tx.membershipSlot.update({
          where: { id: slotsToUpdate[i].id },
          data: { beneficiaryName: finalNames[i] },
        });
      }

      // If slotCount was increased, create additional slots
      if (finalNames.length > existingUserSlots.length) {
        const newNames = finalNames.slice(existingUserSlots.length);
        await tx.membershipSlot.createMany({
          data: newNames.map((beneficiaryName) => ({
            membershipId: membership.id,
            beneficiaryName,
          })),
        });
      }

      // If slotCount was decreased, handle excess slots safely
      if (existingUserSlots.length > finalNames.length) {
        const excessSlots = existingUserSlots.slice(finalNames.length);
        const excessSlotIds = excessSlots.map((s) => s.id);

        if (!isFinished) {
          // In DRAFT before start, slots have no paid contributions or payouts
          await tx.paymentAttempt.updateMany({
            where: {
              OR: [
                { contribution: { membershipSlotId: { in: excessSlotIds } } },
                { fine: { membershipSlotId: { in: excessSlotIds } } },
              ],
            },
            data: { contributionId: null, fineId: null },
          });
          await tx.notification.deleteMany({ where: { membershipSlotId: { in: excessSlotIds } } }).catch(() => {});
          await tx.contribution.deleteMany({ where: { membershipSlotId: { in: excessSlotIds } } });
          await tx.fine.deleteMany({ where: { membershipSlotId: { in: excessSlotIds } } });
          await tx.membershipSlot.deleteMany({ where: { id: { in: excessSlotIds } } });
        } else {
          // If cycle is finished, check each excess slot to preserve historical receipts/payouts
          for (const slot of excessSlots) {
            const hasPaid = await tx.contribution.count({
              where: { membershipSlotId: slot.id, status: "PAID" },
            });
            const hasPayout = await tx.payout.count({
              where: { membershipSlotId: slot.id },
            });
            if (hasPaid === 0 && hasPayout === 0) {
              await tx.paymentAttempt.updateMany({
                where: {
                  OR: [
                    { contribution: { membershipSlotId: slot.id } },
                    { fine: { membershipSlotId: slot.id } },
                  ],
                },
                data: { contributionId: null, fineId: null },
              });
              await tx.notification.deleteMany({ where: { membershipSlotId: slot.id } }).catch(() => {});
              await tx.contribution.deleteMany({ where: { membershipSlotId: slot.id } });
              await tx.fine.deleteMany({ where: { membershipSlotId: slot.id } });
              await tx.membershipSlot.delete({ where: { id: slot.id } });
            } else {
              // Excess slot has historical records — keep the slot record for history integrity
              // but clear its active positions for the upcoming cycle
              await tx.membershipSlot.update({
                where: { id: slot.id },
                data: { officialPosition: null, ballDrawn: null },
              });
            }
          }
        }
      }

      await tx.membership.update({
        where: { id: membership.id },
        data: { slotCount },
      });
    });

    return NextResponse.json({ ok: true, beneficiaryNames: finalNames });
  } catch (err) {
    console.error("[sessions/slots] unexpected error:", err);
    return NextResponse.json(
      { error: "Could not save your slots. Please try again." },
      { status: 500 },
    );
  }
}
