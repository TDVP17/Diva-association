import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getDesignatedSlot } from "@/lib/round-robin-lock";
import { getSessionActiveRoundAndDueDate } from "@/lib/tontine-engine";
import { executeWalletPayoutForSlot } from "@/lib/execute-wallet-payout";

const bodySchema = z.object({
  membershipSlotId: z.string().min(1),
  // Optional backwards-compatibility fields
  mtnPhone: z.string().optional(),
  mtnAccountName: z.string().optional(),
  orangePhone: z.string().optional(),
  orangeAccountName: z.string().optional(),
  phone: z.string().optional(),
  accountName: z.string().optional(),
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
  const { membershipSlotId } = parsed.data;

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
    return NextResponse.json({ error: "Part introuvable" }, { status: 404 });
  }

  if (slot.ballDrawn === null) {
    return NextResponse.json(
      { error: "Vous devez d'abord tirer votre boule avant de pouvoir bouffer la cagnotte." },
      { status: 409 },
    );
  }

  const designatedSlot = await getDesignatedSlot(slot.membership.tontineSessionId);
  if (!designatedSlot || designatedSlot.id !== slot.id) {
    return NextResponse.json({ error: "Ce n'est pas encore votre tour de bouffer." }, { status: 409 });
  }

  // Règle : tous les membres approuvés doivent avoir cotisé pour ce cycle
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

  if (allSlots.length === 0 || paidContributionsCount < allSlots.length) {
    return NextResponse.json(
      { error: "La cagnotte ne peut être versée que lorsque tous les membres ont cotisé pour ce cycle." },
      { status: 409 },
    );
  }

  // Exécution du crédit sur le Portefeuille virtuel DIVA Asso
  const result = await executeWalletPayoutForSlot({
    tontineSessionId: slot.membership.tontineSessionId,
    membershipSlotId: slot.id,
    dueDate,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error || "Erreur lors du crédit de la cagnotte" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    id: result.payoutId,
    netPayout: result.netPayout,
    alreadyPaid: result.alreadyPaid,
  });
}
