import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { getContributionTotal, getNextDueDate } from "@/lib/tontine-engine";
import { settleContribution } from "@/lib/settle-contribution";
import { logAudit } from "@/lib/audit";

const bodySchema = z.object({
  membershipSlotId: z.string().min(1),
  dueDate: z.coerce.date().optional(),
});

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { membershipSlotId } = parsed.data;

  try {
    const slot = await prisma.membershipSlot.findUnique({
      where: { id: membershipSlotId },
      include: { membership: { include: { tontineSession: true } } },
    });
    if (!slot || !["DRAWING", "ACTIVE"].includes(slot.membership.tontineSession.status)) {
      return NextResponse.json({ error: "This slot's session isn't currently open for contributions" }, { status: 404 });
    }
    if (slot.membership.status !== "APPROVED") {
      return NextResponse.json({ error: "This member's join request hasn't been approved yet" }, { status: 403 });
    }

    const { tontineSession } = slot.membership;
    const dueDate = parsed.data.dueDate ?? getNextDueDate(tontineSession.type, new Date());
    const { amount, fee } = getContributionTotal({
      amount: Number(tontineSession.amount),
      fee: Number(tontineSession.fee),
    });

    const existing = await prisma.contribution.findUnique({
      where: { membershipSlotId_dueDate: { membershipSlotId, dueDate } },
    });
    if (existing?.status === "PAID") {
      return NextResponse.json({ error: "This contribution is already paid" }, { status: 409 });
    }

    const outstandingFine = await prisma.fine.findUnique({
      where: { membershipSlotId_dueDate: { membershipSlotId, dueDate } },
    });
    const fineAmount =
      outstandingFine && outstandingFine.status === "UNPAID" ? Number(outstandingFine.amount) : 0;

    const contribution = await prisma.contribution.upsert({
      where: { membershipSlotId_dueDate: { membershipSlotId, dueDate } },
      create: {
        membershipSlotId,
        dueDate,
        amountPaid: amount,
        feePaid: fee,
        finePaid: fineAmount,
        status: "PENDING",
        recordedByAdminId: admin.user.id,
        paidByUserId: admin.user.id,
      },
      update: {
        amountPaid: amount,
        feePaid: fee,
        finePaid: fineAmount,
        recordedByAdminId: admin.user.id,
        paidByUserId: admin.user.id,
      },
      include: {
        membershipSlot: { include: { membership: { include: { user: true, tontineSession: true } } } },
        paidByUser: true,
      },
    });

    const origin = new URL(request.url).origin;
    await settleContribution(contribution, { paidAt: new Date(), origin });

    await logAudit({
      actorId: admin.user.id,
      action: "admin_recorded_payment",
      targetType: "Contribution",
      targetId: contribution.id,
      tontineSessionId: slot.membership.tontineSessionId,
      metadata: { membershipSlotId, amount: Number(contribution.amountPaid) + Number(contribution.feePaid) },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[contributions/manual] unexpected error:", err);
    return NextResponse.json(
      { error: "Could not record this contribution. Please try again." },
      { status: 500 },
    );
  }
}
