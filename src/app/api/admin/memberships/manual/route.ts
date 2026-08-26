import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { resolveUniqueSlotNames } from "@/lib/slot-naming";

const bodySchema = z.object({
  userId: z.string().min(1),
  tontineSessionId: z.string().min(1),
  slotCount: z.coerce.number().min(0.5).max(20),
  beneficiaryNames: z.array(z.string().trim().min(1).max(100)).min(1).max(40),
});

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { userId, tontineSessionId, slotCount, beneficiaryNames } = parsed.data;
  const namedSlots = Math.floor(slotCount);

  if (beneficiaryNames.length !== namedSlots) {
    return NextResponse.json(
      { error: `Please provide exactly ${namedSlots} name(s)` },
      { status: 400 },
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
