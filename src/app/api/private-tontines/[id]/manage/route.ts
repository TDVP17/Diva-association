import { NextResponse } from "next/server";
import crypto from "crypto";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/constants";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import { logAudit } from "@/lib/audit";
import { getPrivateTontineConfig } from "@/lib/private-tontine-config";
import { isStartDateValidForCycle } from "@/lib/cycle-date-validation";
import { evaluatePrivateLaunchReadiness } from "@/lib/private-tontine-finance";

const slotPositionSchema = z.object({
  slotId: z.string().min(1),
  officialPosition: z.number().int().min(1),
});

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
    maxSlots: z.number().int().min(2).max(500).nullable().optional(),
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
    positions: z.array(slotPositionSchema).optional(),
    slotOrders: z.array(slotPositionSchema).optional(),
  }),
  z.object({
    action: z.literal("broadcast_members"),
    message: z.string().trim().min(3, "Le message doit contenir au moins 3 caractères.").max(800),
  }),
  z.object({
    action: z.literal("regenerate_token"),
  }),
  z.object({
    action: z.literal("transfer_ownership"),
    newOwnerUserId: z.string().min(1),
  }),
  z.object({
    action: z.literal("delete_private_session"),
  }),
  z.object({
    action: z.literal("restart_cycle"),
    newStartDate: z.string().min(1),
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
  if (!tontine || !tontine.isPrivate || tontine.softDeletedAt !== null) return null;
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
    return NextResponse.json({ error: "Accès refusé ou cotisation introuvable" }, { status: 403 });
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
  const adminConfig = await getPrivateTontineConfig();
  const minParticipants = tontine.privateMinParticipants ?? adminConfig.minSlots;
  const approvedMembers = tontine.memberships.filter((m) => m.status === "APPROVED");
  const approvedCount = approvedMembers.length;

  // 1. Decide membership (approve/reject pending join request)
  if (payload.action === "decide_membership") {
    if (tontine.privateApprovalStatus !== "APPROVED") {
      return NextResponse.json(
        { error: "La cotisation doit d'abord être validée par l'administrateur DIVA Asso." },
        { status: 403 },
      );
    }

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

      if (payload.decision === "APPROVED") {
        // Lock financial rules once external participants join so creator cannot secretly alter them
        if (!tontine.privateFinancialRulesLockedAt) {
          await tx.tontineSession.update({
            where: { id: tontine.id },
            data: { privateFinancialRulesLockedAt: new Date() },
          });
        }

        if (target.slots.length === 0) {
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

    // Check if minimum participant threshold was JUST reached -> notify creator!
    if (payload.decision === "APPROVED" && approvedCount + 1 === minParticipants && tontine.creatorId) {
      await scheduleInAppNotifications({
        tontineSessionId: tontine.id,
        type: "ADMIN_BROADCAST",
        recipients: [
          {
            userId: tontine.creatorId,
            message: `Minimum de participants atteint (${minParticipants} / ${minParticipants}) pour « ${tontine.title} » ! Vous pourrez organiser le tirage et lancer la cotisation à l'approche de la date de démarrage.`,
            actionUrl: "/private-tontines",
          },
        ],
      }).catch(() => {});
    }

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

  // 2. Remove member
  if (payload.action === "remove_member") {
    const target = tontine.memberships.find((m) => m.id === payload.membershipId);
    if (!target) {
      return NextResponse.json({ error: "Membre introuvable" }, { status: 404 });
    }
    if (target.userId === tontine.creatorId) {
      return NextResponse.json(
        { error: "Le propriétaire ne peut pas se retirer sans transférer la propriété." },
        { status: 400 },
      );
    }
    if (tontine.status === "ACTIVE") {
      return NextResponse.json(
        { error: "Impossible de retirer un membre pendant un cycle actif." },
        { status: 409 },
      );
    }

    await prisma.membership.update({
      where: { id: target.id },
      data: { status: "REJECTED", rejectionReason: "Retiré par le gestionnaire de la cotisation privée" },
    });

    return NextResponse.json({ ok: true, message: `${target.user.name} a été retiré de la cotisation.` });
  }

  // 3. Update details (financial parameters locked once members join or cycle starts!)
  if (payload.action === "update_details") {
    const financialRulesLocked =
      Boolean(tontine.privateFinancialRulesLockedAt) ||
      tontine.status !== "DRAFT" ||
      approvedMembers.some((m) => m.userId !== tontine.creatorId);

    const fineChanged =
      Number(tontine.fineAmountPerPeriod ?? 0) !== Number(payload.fineAmountPerPeriod);

    if (financialRulesLocked && fineChanged) {
      return NextResponse.json(
        {
          error:
            "Les règles financières (amendes, frais, répartition) sont verrouillées une fois que des membres ont rejoint ou que la cotisation a démarré.",
        },
        { status: 409 },
      );
    }

    await prisma.tontineSession.update({
      where: { id: tontine.id },
      data: {
        title: payload.title,
        description: payload.description ?? null,
        limitTime: payload.limitTime,
        ...(financialRulesLocked ? {} : { fineAmountPerPeriod: payload.fineAmountPerPeriod }),
        maxSlots: payload.maxSlots ?? null,
      },
    });
    return NextResponse.json({ ok: true, message: "Paramètres de la cotisation mis à jour." });
  }

  // 4. Set status (strictly enforces Admin approval + minParticipants + startDate readiness!)
  if (payload.action === "set_status") {
    if (tontine.privateApprovalStatus !== "APPROVED" && payload.status !== "DRAFT") {
      return NextResponse.json(
        { error: "Cette cotisation privée doit d'abord être validée par l'administrateur DIVA Asso." },
        { status: 403 },
      );
    }

    if (payload.status === "DRAWING" || payload.status === "ACTIVE") {
      const readiness = evaluatePrivateLaunchReadiness({
        approvedMembersCount: approvedCount,
        minParticipants,
        startDate: tontine.startDate,
      });

      if (!readiness.minimumReached) {
        return NextResponse.json(
          {
            error: `Impossible de lancer cette cotisation : le nombre minimal de participants n'est pas encore atteint (${approvedCount} / ${minParticipants}).`,
          },
          { status: 400 },
        );
      }

      if (payload.status === "ACTIVE" && !readiness.startDateApproachingOrArrived) {
        return NextResponse.json(
          {
            error: `Le minimum de participants est atteint (${approvedCount} / ${minParticipants}), mais la date de démarrage prévue (${tontine.startDate.toLocaleDateString("fr-FR")}) est encore trop éloignée pour activer la cotisation.`,
          },
          { status: 400 },
        );
      }
    }

    await prisma.tontineSession.update({
      where: { id: tontine.id },
      data: {
        status: payload.status,
        ...(payload.status === "ACTIVE" && !tontine.privateFinancialRulesLockedAt
          ? { privateFinancialRulesLockedAt: new Date() }
          : {}),
      },
    });

    if (payload.status === "CLOSED" && approvedMembers.length > 0) {
      await scheduleInAppNotifications({
        tontineSessionId: tontine.id,
        type: "ADMIN_BROADCAST",
        recipients: approvedMembers.map((m) => ({
          userId: m.userId,
          message: `La cotisation privée « ${tontine.title} » est désormais terminée (clôturée). Merci à tous les participants !`,
          actionUrl: `/sessions/${tontine.id}`,
        })),
      }).catch(() => {});
    }

    await logAudit({
      actorId: session.user.id,
      actorRole: session.user.role,
      action: "private_tontine_status_changed",
      targetType: "TontineSession",
      targetId: tontine.id,
      tontineSessionId: tontine.id,
      metadata: { from: tontine.status, to: payload.status },
      request,
    });

    return NextResponse.json({ ok: true, status: payload.status });
  }

  // 5. Pause / Resume
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

  // 6. Lock / Unlock registrations
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

  // 7. Random Draw (creator-initiated, audited, no duplicate positions, enforces minimum participants!)
  if (payload.action === "shuffle_order") {
    if (tontine.privateApprovalStatus !== "APPROVED") {
      return NextResponse.json(
        { error: "La cotisation doit être validée par DIVA Asso avant le tirage." },
        { status: 403 },
      );
    }

    if (approvedCount < minParticipants) {
      return NextResponse.json(
        {
          error: `Impossible de lancer le tirage : au moins ${minParticipants} participants validés sont requis (actuellement ${approvedCount}).`,
        },
        { status: 400 },
      );
    }

    const approvedSlots = approvedMembers.flatMap((m) => m.slots);
    if (approvedSlots.length < 2) {
      return NextResponse.json(
        { error: "Il faut au moins 2 places validées pour effectuer un tirage au sort." },
        { status: 400 },
      );
    }

    // Fisher-Yates unbiased cryptographic shuffle
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

    const drawRecord = shuffled.map((slot, idx) => ({
      slotId: slot.id,
      beneficiaryName: slot.beneficiaryName,
      position: idx + 1,
    }));

    await logAudit({
      actorId: session.user.id,
      actorRole: session.user.role,
      action: "private_tontine_random_draw_executed",
      targetType: "TontineSession",
      targetId: tontine.id,
      tontineSessionId: tontine.id,
      metadata: { drawRecord },
      request,
    });

    if (approvedMembers.length > 0) {
      await scheduleInAppNotifications({
        tontineSessionId: tontine.id,
        type: "DRAW_LAUNCHED",
        recipients: approvedMembers.map((m) => ({
          userId: m.userId,
          message: `Le tirage au sort de la cotisation privée « ${tontine.title || "Cotisation privée"} » a été effectué ! Consultez votre rang de passage.`,
          actionUrl: `/sessions/${tontine.id}`,
        })),
      }).catch(() => {});
    }

    return NextResponse.json({
      ok: true,
      drawRecord,
      message: "Tirage au sort aléatoire effectué et enregistré !",
    });
  }

  // 8. Manual ordering (strictly no duplicate positions)
  if (payload.action === "set_order") {
    const list = payload.positions ?? payload.slotOrders ?? [];
    if (list.length === 0) {
      return NextResponse.json({ error: "Aucune position fournie." }, { status: 400 });
    }
    const posValues = list.map((p) => p.officialPosition);
    if (new Set(posValues).size !== posValues.length) {
      return NextResponse.json(
        { error: "Deux participants ne peuvent pas avoir la même position." },
        { status: 400 },
      );
    }

    const validSlotIds = new Set(tontine.memberships.flatMap((m) => m.slots.map((s) => s.id)));
    const safeList = list.filter((p) => validSlotIds.has(p.slotId));

    await prisma.$transaction(
      safeList.map((p) =>
        prisma.membershipSlot.update({
          where: { id: p.slotId },
          data: { officialPosition: p.officialPosition, ballDrawn: p.officialPosition },
        }),
      ),
    );

    await logAudit({
      actorId: session.user.id,
      actorRole: session.user.role,
      action: "private_tontine_manual_order_updated",
      targetType: "TontineSession",
      targetId: tontine.id,
      tontineSessionId: tontine.id,
      metadata: { positions: safeList },
      request,
    });

    return NextResponse.json({ ok: true, message: "Ordre de passage mis à jour." });
  }

  // 9. Broadcast announcement to members
  if (payload.action === "broadcast_members") {
    const memberIds = approvedMembers
      .map((m) => m.userId)
      .filter((uid) => uid !== session.user.id);

    if (memberIds.length === 0) {
      return NextResponse.json({ error: "Aucun autre membre validé à notifier." }, { status: 400 });
    }

    await scheduleInAppNotifications({
      tontineSessionId: tontine.id,
      type: "ADMIN_BROADCAST",
      recipients: memberIds.map((uid) => ({
        userId: uid,
        message: `Annonce (${tontine.title || "Cotisation privée"}) : ${payload.message}`,
        actionUrl: `/sessions/${tontine.id}`,
      })),
    }).catch(() => {});

    return NextResponse.json({
      ok: true,
      notifiedCount: memberIds.length,
      message: `Annonce envoyée à ${memberIds.length} membre(s).`,
    });
  }

  // 10. Regenerate invite token (ONLY when approved by admin)
  if (payload.action === "regenerate_token") {
    if (tontine.privateApprovalStatus !== "APPROVED") {
      return NextResponse.json(
        { error: "Le lien d'invitation ne peut être régénéré qu'après validation par l'administrateur DIVA Asso." },
        { status: 403 },
      );
    }
    const newToken = crypto.randomBytes(12).toString("base64url");
    await prisma.tontineSession.update({
      where: { id: tontine.id },
      data: { inviteToken: newToken },
    });
    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://divaasso.com").replace(
      /^https?:\/\/www\.divaasso\.com/i,
      "https://divaasso.com",
    );
    return NextResponse.json({
      ok: true,
      inviteToken: newToken,
      inviteUrl: `${baseUrl}/join/${newToken}`,
    });
  }

  // 11. Transfer ownership to another approved member (Section 9.1)
  if (payload.action === "transfer_ownership") {
    const newOwnerMembership = approvedMembers.find(
      (m) => m.userId === payload.newOwnerUserId && m.userId !== tontine.creatorId,
    );
    if (!newOwnerMembership) {
      return NextResponse.json(
        { error: "Le nouveau gestionnaire doit être un membre validé de cette cotisation privée." },
        { status: 400 },
      );
    }

    const oldOwnerId = tontine.creatorId;
    await prisma.tontineSession.update({
      where: { id: tontine.id },
      data: { creatorId: newOwnerMembership.userId },
    });

    await logAudit({
      actorId: session.user.id,
      actorRole: session.user.role,
      action: "private_tontine_ownership_transferred",
      targetType: "TontineSession",
      targetId: tontine.id,
      tontineSessionId: tontine.id,
      metadata: {
        previousOwnerId: oldOwnerId,
        newOwnerId: newOwnerMembership.userId,
        newOwnerName: newOwnerMembership.user.name,
      },
      request,
    });

    const recipientIds = Array.from(
      new Set([...approvedMembers.map((m) => m.userId), ...(oldOwnerId ? [oldOwnerId] : [])]),
    );
    await scheduleInAppNotifications({
      tontineSessionId: tontine.id,
      type: "ADMIN_BROADCAST",
      recipients: recipientIds.map((uid) => ({
        userId: uid,
        message:
          uid === newOwnerMembership.userId
            ? `Vous êtes désormais le nouveau propriétaire et gestionnaire de la cotisation privée « ${tontine.title} ».`
            : `La gestion de la cotisation privée « ${tontine.title} » a été transférée à ${newOwnerMembership.user.name}.`,
        actionUrl: "/private-tontines",
      })),
    }).catch(() => {});

    return NextResponse.json({
      ok: true,
      message: `La propriété a été transférée à ${newOwnerMembership.user.name}.`,
    });
  }

  // 12. Creator safe deletion (Section 9.2 — ONLY when CLOSED and zero pending financial obligations!)
  if (payload.action === "delete_private_session") {
    if (tontine.status !== "CLOSED") {
      return NextResponse.json(
        {
          error:
            "Impossible de supprimer cette cotisation tant qu'elle n'est pas terminée (clôturée). Clôturez d'abord tous les tours.",
        },
        { status: 409 },
      );
    }

    const [unpaidFinesCount, pendingPayoutsCount] = await Promise.all([
      prisma.fine.count({
        where: {
          membershipSlot: { membership: { tontineSessionId: tontine.id } },
          status: "UNPAID",
        },
      }),
      prisma.payout.count({
        where: {
          tontineSessionId: tontine.id,
          status: { in: ["DETAILS_SUBMITTED", "RELEASED"] },
        },
      }),
    ]);

    if (unpaidFinesCount > 0 || pendingPayoutsCount > 0) {
      return NextResponse.json(
        {
          error:
            "Impossible de supprimer cette cotisation : il reste des obligations financières en attente (amendes impayées ou virements non confirmés).",
        },
        { status: 409 },
      );
    }

    await prisma.tontineSession.update({
      where: { id: tontine.id },
      data: { softDeletedAt: new Date(), inviteToken: null },
    });

    await logAudit({
      actorId: session.user.id,
      actorRole: session.user.role,
      action: "private_tontine_soft_deleted_by_creator",
      targetType: "TontineSession",
      targetId: tontine.id,
      tontineSessionId: tontine.id,
      request,
    });

    return NextResponse.json({
      ok: true,
      message: "Cotisation privée supprimée de votre espace actif (historique financier conservé pour audit).",
    });
  }

  // 13. Restart completed contribution as a brand-new cycle without overwriting previous history (Section 9.3)
  if (payload.action === "restart_cycle") {
    if (tontine.status !== "CLOSED") {
      return NextResponse.json(
        { error: "Seule une cotisation privée terminée (clôturée) peut être relancée." },
        { status: 400 },
      );
    }

    const cycleCheck = isStartDateValidForCycle(tontine.type, payload.newStartDate);
    if (!cycleCheck.valid) {
      return NextResponse.json(
        { error: cycleCheck.errorMessage || `Date invalide pour ce cycle (${cycleCheck.expectedLabel}).` },
        { status: 400 },
      );
    }

    const newStartDate = new Date(`${payload.newStartDate.slice(0, 10)}T12:00:00.000Z`);
    const freshToken = crypto.randomBytes(12).toString("base64url");

    const restarted = await prisma.$transaction(async (tx) => {
      const nextSession = await tx.tontineSession.create({
        data: {
          title: tontine.title,
          description: tontine.description,
          type: tontine.type,
          amount: tontine.amount,
          fee: tontine.fee,
          status: "DRAFT",
          startDate: newStartDate,
          limitTime: tontine.limitTime,
          maxSlots: tontine.maxSlots,
          fineAmountPerPeriod: tontine.fineAmountPerPeriod,
          fineIntervalHours: tontine.fineIntervalHours,
          isPrivate: true,
          inviteToken: freshToken,
          creatorId: tontine.creatorId,
          creatorParticipates: tontine.creatorParticipates,
          privateMinParticipants: tontine.privateMinParticipants,
          privateAdditionalFeePayoutPct: tontine.privateAdditionalFeePayoutPct,
          privatePenaltyBeneficiaryPct: tontine.privatePenaltyBeneficiaryPct,
          privateApprovalStatus: "APPROVED",
          privateRulesAcceptedAt: tontine.privateRulesAcceptedAt ?? new Date(),
          privateConfig: tontine.privateConfig ?? undefined,
          parentSessionId: tontine.id,
        },
      });

      // Carry over approved members into the new DRAFT cycle (they can freely leave before start if they choose not to participate!)
      let pos = 1;
      for (const m of approvedMembers) {
        const createdMembership = await tx.membership.create({
          data: {
            userId: m.userId,
            tontineSessionId: nextSession.id,
            status: "APPROVED",
            slotCount: 1,
            disclaimerAcceptedAt: m.disclaimerAcceptedAt ?? new Date(),
          },
        });
        await tx.membershipSlot.create({
          data: {
            membershipId: createdMembership.id,
            beneficiaryName: m.user.name,
            officialPosition: pos,
            ballDrawn: pos,
          },
        });
        pos += 1;
      }

      return nextSession;
    });

    if (approvedMembers.length > 0) {
      await scheduleInAppNotifications({
        tontineSessionId: restarted.id,
        type: "ADMIN_BROADCAST",
        recipients: approvedMembers.map((m) => ({
          userId: m.userId,
          message: `Un nouveau cycle de « ${restarted.title} » démarre le ${newStartDate.toLocaleDateString("fr-FR")}. Si vous ne souhaitez pas participer à ce nouveau cycle, vous pouvez quitter le groupe librement avant son démarrage.`,
          actionUrl: "/private-tontines",
        })),
      }).catch(() => {});
    }

    await logAudit({
      actorId: session.user.id,
      actorRole: session.user.role,
      action: "private_tontine_cycle_restarted",
      targetType: "TontineSession",
      targetId: restarted.id,
      tontineSessionId: restarted.id,
      metadata: { previousSessionId: tontine.id, newStartDate: newStartDate.toISOString() },
      request,
    });

    return NextResponse.json({
      ok: true,
      newSessionId: restarted.id,
      message: "Nouveau cycle créé ! L'historique du cycle précédent est intégralement préservé.",
    });
  }

  return NextResponse.json({ error: "Action inconnue" }, { status: 400 });
}
