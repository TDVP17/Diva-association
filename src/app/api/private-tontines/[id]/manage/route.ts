import { NextResponse } from "next/server";
import crypto from "crypto";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/constants";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import { logAudit } from "@/lib/audit";

const patchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("decide_membership"),
    membershipId: z.string().min(1),
    decision: z.enum(["APPROVED", "REJECTED"]),
    reason: z.string().max(300).optional(),
  }),
  z.object({
    action: z.literal("set_status"),
    status: z.enum(["DRAFT", "DRAWING", "ACTIVE", "CLOSED"]),
  }),
  z.object({
    action: z.literal("set_order"),
    positions: z.array(
      z.object({
        slotId: z.string().min(1),
        officialPosition: z.number().int().min(1),
      }),
    ),
  }),
  z.object({
    action: z.literal("regenerate_token"),
  }),
]);

async function assertManager(tontineId: string, userId: string, role?: string) {
  const tontine = await prisma.tontineSession.findUnique({
    where: { id: tontineId },
    include: {
      memberships: {
        include: {
          user: { select: { id: true, name: true } },
          slots: true,
        },
      },
    },
  });
  if (!tontine || !tontine.isPrivate) return null;
  if (tontine.creatorId !== userId && !isAdminRole(role)) return null;
  return tontine;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const { id } = await context.params;
  const tontine = await assertManager(id, session.user.id, session.user.role);
  if (!tontine) {
    return NextResponse.json({ error: "Accès refusé ou tontine introuvable" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Action invalide" }, { status: 400 });
  }

  const payload = parsed.data;

  if (payload.action === "decide_membership") {
    const target = tontine.memberships.find((m) => m.id === payload.membershipId);
    if (!target) {
      return NextResponse.json({ error: "Demande introuvable" }, { status: 404 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.membership.update({
        where: { id: target.id },
        data: {
          status: payload.decision,
          rejectionReason: payload.decision === "REJECTED" ? (payload.reason || null) : null,
          ...(payload.decision === "APPROVED" && target.slotCount === null ? { slotCount: 1 } : {}),
        },
      });

      // Ensure at least 1 named slot exists when approved
      if (payload.decision === "APPROVED" && target.slots.length === 0) {
        const existingMaxPos = await tx.membershipSlot.aggregate({
          where: { membership: { tontineSessionId: tontine.id } },
          _max: { officialPosition: true },
        });
        const nextPos = (existingMaxPos._max.officialPosition ?? 0) + 1;
        await tx.membershipSlot.create({
          data: {
            membershipId: target.id,
            beneficiaryName: target.user.name,
            officialPosition: nextPos,
            ballDrawn: nextPos,
          },
        });
      }
    });

    await scheduleInAppNotifications({
      tontineSessionId: tontine.id,
      type: payload.decision === "APPROVED" ? "MEMBER_APPROVED" : "MEMBER_REJECTED",
      recipients: [
        {
          userId: target.userId,
          message:
            payload.decision === "APPROVED"
              ? `Votre adhésion à la tontine privée « ${tontine.title || "Tontine privée"} » a été acceptée !`
              : `Votre demande d'adhésion à « ${tontine.title || "Tontine privée"} » a été refusée.${payload.reason ? ` Motif : ${payload.reason}` : ""}`,
          actionUrl: payload.decision === "APPROVED" ? `/sessions/${tontine.id}` : `/sessions`,
        },
      ],
    }).catch(() => {});

    await logAudit({
      actorId: session.user.id,
      actorRole: session.user.role,
      action: `private_tontine_member_${payload.decision.toLowerCase()}`,
      targetType: "Membership",
      targetId: target.id,
      tontineSessionId: tontine.id,
      request,
    });

    return NextResponse.json({ ok: true, status: payload.decision });
  }

  if (payload.action === "set_status") {
    await prisma.tontineSession.update({
      where: { id: tontine.id },
      data: { status: payload.status },
    });
    return NextResponse.json({ ok: true, status: payload.status });
  }

  if (payload.action === "set_order") {
    const validSlotIds = new Set(tontine.memberships.flatMap((m) => m.slots.map((s) => s.id)));
    for (const item of payload.positions) {
      if (!validSlotIds.has(item.slotId)) {
        return NextResponse.json({ error: "Slot invalide pour cette tontine" }, { status: 400 });
      }
    }

    await prisma.$transaction(
      payload.positions.map((item) =>
        prisma.membershipSlot.update({
          where: { id: item.slotId },
          data: {
            officialPosition: item.officialPosition,
            ballDrawn: item.officialPosition,
          },
        }),
      ),
    );
    return NextResponse.json({ ok: true });
  }

  if (payload.action === "regenerate_token") {
    const newToken = crypto.randomBytes(12).toString("base64url");
    await prisma.tontineSession.update({
      where: { id: tontine.id },
      data: { inviteToken: newToken },
    });
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://divaasso.com";
    return NextResponse.json({ ok: true, inviteToken: newToken, inviteUrl: `${baseUrl}/join/${newToken}` });
  }

  return NextResponse.json({ error: "Action non supportée" }, { status: 400 });
}
