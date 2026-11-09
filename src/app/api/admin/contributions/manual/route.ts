import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { getContributionTotal } from "@/lib/tontine-engine";
import { resolveDueDateForSlot } from "@/lib/initiate-slot-payment";
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
    const dueDate = await resolveDueDateForSlot(membershipSlotId, tontineSession, parsed.data.dueDate);
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

    const contribution = await prisma.contribution.upsert({
      where: { membershipSlotId_dueDate: { membershipSlotId, dueDate } },
      create: {
        membershipSlotId,
        dueDate,
        amountPaid: amount,
        feePaid: fee,
        finePaid: 0,
        status: "PAID",
        paidAt: new Date(),
        recordedByAdminId: admin.user.id,
        paidByUserId: slot.membership.userId,
      },
      update: {
        amountPaid: amount,
        feePaid: fee,
        status: "PAID",
        paidAt: new Date(),
        recordedByAdminId: admin.user.id,
        paidByUserId: existing?.paidByUserId ?? slot.membership.userId,
        failureReason: null,
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
      actorRole: admin.user.role,
      action: "admin_recorded_payment",
      targetType: "Contribution",
      targetId: contribution.id,
      tontineSessionId: slot.membership.tontineSessionId,
      metadata: { membershipSlotId, amount: Number(contribution.amountPaid) + Number(contribution.feePaid) },
      request,
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
