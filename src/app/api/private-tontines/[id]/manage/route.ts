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
    action: z.literal("remove_member"),
    membershipId: z.string().min(1),
  }),
  z.object({
    action: z.literal("update_details"),
    title: z.string().trim().min(3).max(100),
    description: z.string().trim().max(500).nullable().optional(),
    limitTime: z.string().regex(/^\d{2}:\d{2}$/),
    fineAmountPerPeriod: z.number().int().min(0).max(100_000),
    maxSlots: z.number().int().min(2).max(100).nullable().optional(),
  }),
  z.object({
    action: z.literal("set_status"),
    status: z.enum(["DRAFT", "DRAWING", "ACTIVE", "CLOSED"]),
  }),
  z.object({
    action: z.literal("toggle_pause"),
  }),
  z.object({
    action: z.literal("toggle_lock"),
  }),
  z.object({
    action: z.literal("shuffle_order"),
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
    action: z.literal("broadcast_members"),
    message: z.string().trim().min(5, "Le message doit contenir au moins 5 caractères.").max(800),
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
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Action invalide" },
      { status: 400 },
    );
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
              ? `Votre adhésion à la cotisation privée « ${tontine.title || "Cotisation privée"} » a été acceptée !`
              : `Votre demande d'adhésion à « ${tontine.title || "Cotisation privée"} » a été refusée.${payload.reason ? ` Motif : ${payload.reason}` : ""}`,
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

  if (payload.action === "remove_member") {
    const target = tontine.memberships.find((m) => m.id === payload.membershipId);
    if (!target) {
      return NextResponse.json({ error: "Membre introuvable" }, { status: 404 });
    }
    if (target.userId === tontine.creatorId) {
      return NextResponse.json({ error: "Le propriétaire ne peut pas se retirer lui-même." }, { status: 400 });
    }

    await prisma.membership.update({
      where: { id: target.id },
      data: { status: "REJECTED", rejectionReason: "Retiré par le propriétaire de la cotisation privée" },
    });

    return NextResponse.json({ ok: true, message: `${target.user.name} a été retiré de la cotisation.` });
  }

  if (payload.action === "update_details") {
    await prisma.tontineSession.update({
      where: { id: tontine.id },
      data: {
        title: payload.title,
        description: payload.description ?? null,
        limitTime: payload.limitTime,
        fineAmountPerPeriod: payload.fineAmountPerPeriod,
        maxSlots: payload.maxSlots ?? null,
      },
    });
    return NextResponse.json({ ok: true, message: "Paramètres de la cotisation mis à jour." });
  }

  if (payload.action === "set_status") {
    if (tontine.privateApprovalStatus !== "APPROVED" && payload.status === "ACTIVE") {
      return NextResponse.json(
        { error: "Cette cotisation privée doit d'abord être validée par l'administrateur DIVA Asso." },
        { status: 403 },
      );
    }
    await prisma.tontineSession.update({
      where: { id: tontine.id },
      data: { status: payload.status },
    });
    return NextResponse.json({ ok: true, status: payload.status });
  }

  if (payload.action === "toggle_pause") {
    const nextPaused = !tontine.isPaused;
    await prisma.tontineSession.update({
      where: { id: tontine.id },
      data: { isPaused: nextPaused },
    });
    return NextResponse.json({
      ok: true,
      isPaused: nextPaused,
      message: nextPaused ? "Cotisation mise en pause." : "Cotisation réactivée.",
    });
  }

  if (payload.action === "toggle_lock") {
    const nextLocked = tontine.lockedAt ? null : new Date();
    await prisma.tontineSession.update({
      where: { id: tontine.id },
      data: { lockedAt: nextLocked },
    });
    return NextResponse.json({
      ok: true,
      isLocked: Boolean(nextLocked),
      message: nextLocked ? "Inscriptions verrouillées." : "Inscriptions réouvertes.",
    });
  }

  if (payload.action === "shuffle_order") {
    const approvedSlots = tontine.memberships
      .filter((m) => m.status === "APPROVED")
      .flatMap((m) => m.slots);

    if (approvedSlots.length < 2) {
      return NextResponse.json(
        { error: "Il faut au moins 2 membres validés pour effectuer un tirage au sort." },
        { status: 400 },
      );
    }

    // Fisher-Yates shuffle
    const shuffled = [...approvedSlots];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = crypto.randomInt(0, i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    await prisma.$transaction(
      shuffled.map((slot, idx) =>
        prisma.membershipSlot.update({
          where: { id: slot.id },
          data: { officialPosition: idx + 1, ballDrawn: idx + 1 },
        }),
      ),
    );

    return NextResponse.json({
      ok: true,
      message: `Tirage au sort effectué sur ${shuffled.length} participant(s) !`,
    });
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
    return NextResponse.json({ ok: true, message: "Ordre de passage mis à jour !" });
  }

  if (payload.action === "broadcast_members") {
    const recipients = tontine.memberships
      .filter((m) => m.status === "APPROVED")
      .map((m) => ({
        userId: m.userId,
        message: `📢 [${tontine.title || "Cotisation privée"}] ${payload.message}`,
        actionUrl: `/sessions/${tontine.id}`,
      }));

    if (recipients.length === 0) {
      return NextResponse.json({ error: "Aucun membre validé à notifier." }, { status: 400 });
    }

    await scheduleInAppNotifications({
      tontineSessionId: tontine.id,
      type: "ADMIN_BROADCAST",
      recipients,
    });

    return NextResponse.json({
      ok: true,
      message: `Annonce envoyée à ${recipients.length} membre(s) !`,
    });
  }

  if (payload.action === "regenerate_token") {
    if (tontine.privateApprovalStatus !== "APPROVED") {
      return NextResponse.json(
        { error: "Le lien d'invitation ne peut être généré qu'après validation par l'administrateur DIVA Asso." },
        { status: 403 },
      );
    }
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
