import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { resolveUniqueSlotNames } from "@/lib/slot-naming";
import { checkUserFinesForJoining } from "@/lib/unsettled-fines-gate";

const bodySchema = z.object({
  userId: z.string().min(1),
  tontineSessionId: z.string().min(1),
  slotCount: z.coerce.number().int().min(1).max(10),
  beneficiaryNames: z.array(z.string().trim().min(1).max(100)).min(1).max(10),
});

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { userId, tontineSessionId, slotCount, beneficiaryNames } = parsed.data;

  if (beneficiaryNames.length !== slotCount) {
    return NextResponse.json(
      { error: `Please provide exactly ${slotCount} name(s)` },
      { status: 400 },
    );
  }

  const tontineSession = await prisma.tontineSession.findUnique({
    where: { id: tontineSessionId },
    select: { status: true },
  });
  if (!tontineSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (tontineSession.status !== "DRAFT") {
    return NextResponse.json(
      { error: "Impossible d'ajouter un membre : le tirage au sort a déjà été lancé ou la cotisation est en cours." },
      { status: 409 },
    );
  }

  const targetUser = await prisma.user.findUnique({ where: { id: userId } });
  if (!targetUser || targetUser.role !== "MEMBER") {
    return NextResponse.json({ error: "This user cannot be added as a member" }, { status: 400 });
  }

  const existingMembership = await prisma.membership.findUnique({
    where: { userId_tontineSessionId: { userId, tontineSessionId } },
  });
  if (existingMembership && existingMembership.status !== "REJECTED") {
    return NextResponse.json({ error: "This user is already a member of this session" }, { status: 409 });
  }

  const finesCheck = await checkUserFinesForJoining(userId, tontineSessionId);
  if (!finesCheck.canJoin) {
    return NextResponse.json(
      { error: `Impossible d'ajouter ce membre : il a des amendes impayées (${finesCheck.totalUnpaidAmount.toLocaleString()} FCFA) à finaliser avant d'intégrer une nouvelle cotisation.` },
      { status: 409 },
    );
  }

  const existingSlots = await prisma.membershipSlot.findMany({
    where: { membership: { tontineSessionId } },
    select: { beneficiaryName: true },
  });
  const finalNames = resolveUniqueSlotNames(
    existingSlots.map((s) => s.beneficiaryName),
    beneficiaryNames,
  );

  try {
    await prisma.$transaction(async (tx) => {
      const membership = existingMembership
        ? await tx.membership.update({
            where: { id: existingMembership.id },
            data: { status: "APPROVED", slotCount },
          })
        : await tx.membership.create({
            data: { userId, tontineSessionId, status: "APPROVED", slotCount },
          });
      await tx.membershipSlot.createMany({
        data: finalNames.map((beneficiaryName) => ({ membershipId: membership.id, beneficiaryName })),
      });
    });

    return NextResponse.json({ ok: true, beneficiaryNames: finalNames });
  } catch (err) {
    console.error("[admin/memberships/manual] unexpected error:", err);
    return NextResponse.json({ error: "Could not add this member. Please try again." }, { status: 500 });
  }
}
