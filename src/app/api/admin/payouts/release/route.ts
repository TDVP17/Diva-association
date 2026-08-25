import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { getMostRecentDueDate } from "@/lib/tontine-engine";
import { sendWhatsAppMessageSafe } from "@/lib/whatsapp/evolution";

const bodySchema = z.object({
  tontineSessionId: z.string().min(1),
  membershipSlotId: z.string().min(1),
});

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { tontineSessionId, membershipSlotId } = parsed.data;

  const [tontineSession, slot] = await Promise.all([
    prisma.tontineSession.findUnique({ where: { id: tontineSessionId } }),
    prisma.membershipSlot.findUnique({
      where: { id: membershipSlotId },
      include: { membership: { include: { user: true } } },
    }),
  ]);
  if (!tontineSession || !slot || slot.membership.tontineSessionId !== tontineSessionId) {
    return NextResponse.json({ error: "Session or slot not found" }, { status: 404 });
  }

  const dueDate = getMostRecentDueDate(tontineSession.type, new Date());

  const [potAgg, unpaidFines] = await Promise.all([
    prisma.contribution.aggregate({
      where: { membershipSlot: { membership: { tontineSessionId } }, dueDate, status: "PAID" },
      _sum: { amountPaid: true },
    }),
    prisma.fine.findMany({
      where: { membershipSlotId, status: "UNPAID" },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const pot = Number(potAgg._sum.amountPaid ?? 0);

  let deducted = 0;
  const toDeduct: string[] = [];
  for (const fine of unpaidFines) {
    const amount = Number(fine.amount);
    if (deducted + amount > pot) break;
    deducted += amount;
    toDeduct.push(fine.id);
  }
  const netPayout = pot - deducted;

  if (toDeduct.length > 0) {
    await prisma.fine.updateMany({
      where: { id: { in: toDeduct } },
      data: { status: "DEDUCTED" },
    });
  }

  const { user } = slot.membership;
  await sendWhatsAppMessageSafe(
    user.phone,
    `🎉 Payout released — DIVA Associations\n\n` +
      `Congratulations ${user.name} (${slot.beneficiaryName})! Your payout of ${netPayout.toLocaleString("en-US")} F has been released` +
      (deducted > 0 ? ` after deducting ${deducted.toLocaleString("en-US")} F in outstanding fines.` : `.`),
  );

  return NextResponse.json({ pot, deducted, netPayout, dueDate: dueDate.toISOString() });
}
