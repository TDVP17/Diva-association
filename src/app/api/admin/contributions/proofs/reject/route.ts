import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { logAudit } from "@/lib/audit";

const bodySchema = z.object({
  contributionId: z.string().optional(),
  membershipSlotId: z.string().optional(),
  dueDate: z.coerce.date().optional(),
  reason: z.string().optional(),
});

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { contributionId, membershipSlotId, dueDate, reason } = parsed.data;

  try {
    const contribution = contributionId
      ? await prisma.contribution.findUnique({
          where: { id: contributionId },
          include: { membershipSlot: { include: { membership: { include: { user: true, tontineSession: true } } } } },
        })
      : membershipSlotId && dueDate
      ? await prisma.contribution.findUnique({
          where: { membershipSlotId_dueDate: { membershipSlotId, dueDate } },
          include: { membershipSlot: { include: { membership: { include: { user: true, tontineSession: true } } } } },
        })
      : null;

    if (!contribution) {
      return NextResponse.json({ error: "Contribution not found" }, { status: 404 });
    }

    const rejectionReason = reason?.trim() || "Preuve de paiement rejetée par l'administrateur";

    await prisma.contribution.update({
      where: { id: contribution.id },
      data: {
        proofImageUrl: null,
        failureReason: rejectionReason,
        status: "FAILED",
      },
    });

    const user = contribution.membershipSlot.membership.user;
    const session = contribution.membershipSlot.membership.tontineSession;

    await prisma.notification.create({
      data: {
        userId: user.id,
        tontineSessionId: session.id,
        channel: "IN_APP",
        type: "ADMIN_BROADCAST",
        message: `Votre preuve de paiement pour ${contribution.membershipSlot.beneficiaryName} a été rejetée : ${rejectionReason}. Veuillez réessayer.`,
        actionUrl: `/sessions/${session.id}`,
        status: "SENT",
      },
    });

    await logAudit({
      actorId: admin.user.id,
      actorRole: admin.user.role,
      action: "admin_recorded_payment",
      targetType: "Contribution",
      targetId: contribution.id,
      tontineSessionId: session.id,
      metadata: { action: "rejected_proof", reason: rejectionReason },
      request,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[proofs/reject] unexpected error:", err);
    return NextResponse.json({ error: "Could not reject proof" }, { status: 500 });
  }
}
