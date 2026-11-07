import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { resolveUniqueSlotNames } from "@/lib/slot-naming";
import { isSessionCycleFinished } from "@/lib/tontine-engine";

const bodySchema = z.object({
  slotCount: z.coerce.number().int().min(1).max(15),
  beneficiaryNames: z.array(z.string().trim().min(1).max(100)).min(1).max(15),
  slotIds: z.array(z.string().nullable().optional()).optional(),
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
  const { slotCount, beneficiaryNames, slotIds } = parsed.data;

  if (beneficiaryNames.length !== slotCount) {
    return NextResponse.json(
      { error: `Please provide exactly ${slotCount} name(s)` },
      { status: 400 },
    );
  }
  if (slotIds !== undefined && slotIds.length !== slotCount) {
    return NextResponse.json(
      { error: "Invalid slotIds length" },
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

    const membership = await prisma.membership.findUnique({
      where: { userId_tontineSessionId: { userId: session.user.id, tontineSessionId } },
    });
    if (!membership || membership.status !== "APPROVED") {
      return NextResponse.json({ error: "Your membership isn't approved yet" }, { status: 403 });
    }

    if (tontineSession.status === "CLOSED" && !isFinished) {
      return NextResponse.json(
        { error: "Cette cotisation est clôturée." },
        { status: 409 },
      );
    }

    const isInitialLateSelection =
      membership.slotCount === null && tontineSession.status !== "CLOSED";
    const isFullEditAllowed =
      tontineSession.status === "DRAFT" || isFinished || isInitialLateSelection;

    if (!isFullEditAllowed) {
      // Rename-only mode when cotisation is ongoing (DRAWING / ACTIVE):
      // the member can rename their existing names, while only the admin can add/remove slots.
      const currentMemberSlotsCount = await prisma.membershipSlot.count({
        where: { membershipId: membership.id },
      });
      if (slotCount !== currentMemberSlotsCount) {
        return NextResponse.json(
          {
            error:
              "La cotisation a déjà commencé : seul l'administrateur peut ajouter ou retirer des noms. Vous pouvez uniquement renommer vos noms existants.",
          },
          { status: 409 },
        );
      }
      if (
        slotIds &&
        slotIds.some((sid) => typeof sid !== "string" || !sid.trim())
      ) {
        return NextResponse.json(
          {
            error:
              "Seul l'administrateur peut ajouter de nouveaux noms en cours de cotisation.",
          },
          { status: 409 },
        );
      }
    }

    if (isFullEditAllowed && tontineSession.maxSlots !== null) {
      // Ensure a single member is always permitted to register up to 15 slots in the session
      const maxAllowed = Math.max(Number(tontineSession.maxSlots), 15);
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

      const existingById = new Map(existingUserSlots.map((s) => [s.id, s]));
      const hasValidExplicitIds =
        Array.isArray(slotIds) &&
        slotIds.every((sid) => sid === null || sid === undefined || existingById.has(sid)) &&
        new Set(slotIds.filter((sid): sid is string => Boolean(sid))).size ===
          slotIds.filter((sid): sid is string => Boolean(sid)).length;

      if (!isFullEditAllowed) {
        // Rename-only mode: strictly update existing slots in place without creating or deleting any slot
        if (existingUserSlots.length !== finalNames.length) {
          throw new Error("SLOT_COUNT_MISMATCH");
        }
        if (hasValidExplicitIds && slotIds && slotIds.every((sid): sid is string => Boolean(sid))) {
          for (let i = 0; i < finalNames.length; i++) {
            await tx.membershipSlot.update({
              where: { id: slotIds[i] },
              data: { beneficiaryName: finalNames[i] },
            });
          }
        } else {
          for (let i = 0; i < existingUserSlots.length; i++) {
            await tx.membershipSlot.update({
              where: { id: existingUserSlots[i].id },
              data: { beneficiaryName: finalNames[i] },
            });
          }
        }
        return;
      }

      let newNames: string[] = [];
      let excessSlots: typeof existingUserSlots = [];

      if (hasValidExplicitIds && slotIds) {
        const keptSlotIds = new Set<string>();
        for (let i = 0; i < finalNames.length; i++) {
          const sid = slotIds[i];
          if (sid) {
            keptSlotIds.add(sid);
            await tx.membershipSlot.update({
              where: { id: sid },
              data: { beneficiaryName: finalNames[i] },
            });
          } else {
            newNames.push(finalNames[i]);
          }
        }
        excessSlots = existingUserSlots.filter((s) => !keptSlotIds.has(s.id));
      } else {
        // Fallback positional update when slotIds are omitted
        const slotsToUpdate = existingUserSlots.slice(0, finalNames.length);
        for (let i = 0; i < slotsToUpdate.length; i++) {
          await tx.membershipSlot.update({
            where: { id: slotsToUpdate[i].id },
            data: { beneficiaryName: finalNames[i] },
          });
        }
        if (finalNames.length > existingUserSlots.length) {
          newNames = finalNames.slice(existingUserSlots.length);
        }
        if (existingUserSlots.length > finalNames.length) {
          excessSlots = existingUserSlots.slice(finalNames.length);
        }
      }

      // If new slots were added, create them at the end
      if (newNames.length > 0) {
        const currentApprovedSlots = await tx.membershipSlot.findMany({
          where: { membership: { tontineSessionId, status: "APPROVED" }, NOT: { membershipId: membership.id } },
          select: { officialPosition: true },
        });
        const keptExistingSlots = existingUserSlots.filter(
          (s) => !excessSlots.some((ex) => ex.id === s.id),
        );
        const allKnownPositions = [
          ...currentApprovedSlots.map((s) => s.officialPosition ?? 0),
          ...keptExistingSlots.map((s) => s.officialPosition ?? 0),
        ];
        const maxOfficialPos = Math.max(0, ...allKnownPositions);
        const totalPriorApprovedCount = currentApprovedSlots.length + keptExistingSlots.length;
        const isStartedRunning = tontineSession.status !== "DRAFT" && !isFinished;

        const nextPos = isStartedRunning
          ? Math.max(maxOfficialPos, totalPriorApprovedCount) + 1
          : maxOfficialPos > 0
            ? maxOfficialPos + 1
            : null;

        await tx.membershipSlot.createMany({
          data: newNames.map((beneficiaryName, idx) => {
            const pos = nextPos !== null ? nextPos + idx : null;
            return {
              membershipId: membership.id,
              beneficiaryName,
              officialPosition: pos,
              ballDrawn: isStartedRunning && pos !== null ? pos : null,
            };
          }),
        });

        const newTotalApproved = totalPriorApprovedCount + newNames.length;
        if (
          isStartedRunning &&
          tontineSession.maxSlots !== null &&
          newTotalApproved > Number(tontineSession.maxSlots)
        ) {
          await tx.tontineSession.update({
            where: { id: tontineSessionId },
            data: { maxSlots: newTotalApproved },
          });
        }
      }

      // If slots were removed, handle excess slots safely
      if (excessSlots.length > 0) {
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
