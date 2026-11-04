import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { getContributionTotal } from "@/lib/tontine-engine";
import { settleContribution } from "@/lib/settle-contribution";
import { logAudit } from "@/lib/audit";

const bodySchema = z.object({
  contributionIds: z.array(z.string().min(1)).min(1).max(30),
});

/**
 * Approves and checks ("coche") one or more member slot contributions for which
 * a fallback payment screenshot proof was submitted when the operator network failed.
 * Strictly gated to contributions that actually have an uploaded proof image.
 */
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const uniqueIds = [...new Set(parsed.data.contributionIds)];

  try {
    const contributions = await prisma.contribution.findMany({
      where: { id: { in: uniqueIds } },
      include: {
        membershipSlot: {
          include: {
            membership: {
              include: { user: true, tontineSession: true },
            },
          },
        },
        paidByUser: true,
      },
    });

    if (contributions.length === 0) {
      return NextResponse.json({ error: "Aucune cotisation trouvée." }, { status: 404 });
    }

    for (const c of contributions) {
      const hasProof = Boolean(c.proofImageUrl || (c.proofImageUrls && c.proofImageUrls.length > 0));
      if (!hasProof && c.status !== "PAID") {
        return NextResponse.json(
          {
            error:
              "La validation manuelle n'est autorisée que lorsqu'une preuve de paiement a été envoyée suite à un problème réseau.",
          },
          { status: 400 },
        );
      }
    }

    const origin = new URL(request.url).origin;
    const paidAt = new Date();
    let settledCount = 0;

    for (const c of contributions) {
      if (c.status === "PAID") continue;

      const tontineSession = c.membershipSlot.membership.tontineSession;
      const { amount, fee } = getContributionTotal({
        amount: Number(tontineSession.amount),
        fee: Number(tontineSession.fee),
      });

      const updated = await prisma.contribution.update({
        where: { id: c.id },
        data: {
          amountPaid: amount,
          feePaid: fee,
          recordedByAdminId: admin.user.id,
          paidByUserId: c.paidByUserId ?? c.membershipSlot.membership.userId,
          failureReason: null,
        },
        include: {
          membershipSlot: {
            include: {
              membership: { include: { user: true, tontineSession: true } },
            },
          },
          paidByUser: true,
        },
      });

      await settleContribution(updated, { paidAt, origin });
      settledCount++;

      await logAudit({
        actorId: admin.user.id,
        actorRole: admin.user.role,
        action: "admin_recorded_payment",
        targetType: "Contribution",
        targetId: updated.id,
        tontineSessionId: tontineSession.id,
        metadata: {
          action: "approved_payment_proof",
          membershipSlotId: updated.membershipSlotId,
          beneficiaryName: updated.membershipSlot.beneficiaryName,
          amount: Number(updated.amountPaid) + Number(updated.feePaid),
          proofImageUrls: updated.proofImageUrls,
        },
        request,
      });
    }

    return NextResponse.json({ ok: true, settledCount });
  } catch (err) {
    console.error("[proofs/approve] unexpected error:", err);
    return NextResponse.json(
      { error: "Impossible de valider cette preuve pour le moment." },
      { status: 500 },
    );
  }
}

