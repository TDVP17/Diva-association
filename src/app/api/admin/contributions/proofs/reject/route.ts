import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { logAudit } from "@/lib/audit";
import { sendPushToUser } from "@/lib/push/send";

const bodySchema = z.object({
  contributionId: z.string().optional(),
  contributionIds: z.array(z.string().min(1)).max(30).optional(),
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

  const { contributionId, contributionIds, membershipSlotId, dueDate, reason } = parsed.data;

  try {
    const targetIds = [
      ...(contributionIds ?? []),
      ...(contributionId ? [contributionId] : []),
    ];

    const contributions =
      targetIds.length > 0
        ? await prisma.contribution.findMany({
            where: { id: { in: [...new Set(targetIds)] } },
            include: {
              membershipSlot: {
                include: { membership: { include: { user: true, tontineSession: true } } },
              },
            },
          })
        : membershipSlotId && dueDate
          ? await prisma.contribution.findMany({
              where: { membershipSlotId, dueDate },
              include: {
                membershipSlot: {
                  include: { membership: { include: { user: true, tontineSession: true } } },
                },
              },
            })
          : [];

    if (contributions.length === 0) {
      return NextResponse.json({ error: "Contribution not found" }, { status: 404 });
    }

    const rejectionReason = reason?.trim() || "Preuve de paiement rejetée par l'administrateur";

    const notifiedByUserSession = new Map<
      string,
      { userId: string; sessionId: string; names: string[] }
    >();

    for (const contribution of contributions) {
      if (contribution.status === "PAID") continue;

      await prisma.contribution.update({
        where: { id: contribution.id },
        data: {
          proofImageUrl: null,
          proofImageUrls: [],
          failureReason: rejectionReason,
          status: "FAILED",
        },
      });

      const user = contribution.membershipSlot.membership.user;
      const session = contribution.membershipSlot.membership.tontineSession;
      const groupKey = `${user.id}:${session.id}`;
      const existingGroup = notifiedByUserSession.get(groupKey) ?? {
        userId: user.id,
        sessionId: session.id,
        names: [],
      };
      existingGroup.names.push(contribution.membershipSlot.beneficiaryName);
      notifiedByUserSession.set(groupKey, existingGroup);

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
    }

    for (const group of notifiedByUserSession.values()) {
      const namesLabel = group.names.join(", ");
      const message = `Votre preuve de paiement pour ${namesLabel} n'a pas été validée : ${rejectionReason}. Veuillez vérifier et renvoyer une capture valide.`;
      const actionUrl = `/sessions/${group.sessionId}`;

      await prisma.notification.create({
        data: {
          userId: group.userId,
          tontineSessionId: group.sessionId,
          channel: "IN_APP",
          type: "ADMIN_BROADCAST",
          message,
          actionUrl,
          status: "SENT",
        },
      });

      void sendPushToUser(group.userId, {
        title: "Preuve de paiement non validée",
        body: message,
        url: actionUrl,
      }).catch(() => {});
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[proofs/reject] unexpected error:", err);
    return NextResponse.json({ error: "Could not reject proof" }, { status: 500 });
  }
}
