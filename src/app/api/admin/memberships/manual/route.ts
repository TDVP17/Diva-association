import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { resolveUniqueSlotNames } from "@/lib/slot-naming";
import { checkUserFinesForJoining } from "@/lib/unsettled-fines-gate";
import { ensureMemberCode } from "@/lib/member-code";
import { logAudit } from "@/lib/audit";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import { translate } from "@/lib/i18n/translations";
import { TONTINE_TYPE_LABELS } from "@/lib/tontine-labels";

const bodySchema = z.object({
  userId: z.string().min(1),
  tontineSessionId: z.string().min(1),
  slotCount: z.coerce.number().int().min(1).max(15),
  beneficiaryNames: z.array(z.string().trim().min(1).max(100)).min(1).max(15),
});

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { userId, tontineSessionId, slotCount, beneficiaryNames } = parsed.data;

  if (beneficiaryNames.length !== slotCount) {
    return NextResponse.json(
      { error: `Please provide exactly ${slotCount} name(s)` },
      { status: 400 },
    );
  }

  const tontineSession = await prisma.tontineSession.findUnique({
    where: { id: tontineSessionId },
    select: { status: true, title: true, type: true, maxSlots: true },
  });
  if (!tontineSession) {
    return NextResponse.json({ error: "Cotisation introuvable." }, { status: 404 });
  }
  if (tontineSession.status === "CLOSED") {
    return NextResponse.json(
      { error: "Impossible d'ajouter des noms : cette cotisation est clôturée." },
      { status: 409 },
    );
  }

  const targetUser = await prisma.user.findUnique({ where: { id: userId } });
  if (!targetUser || targetUser.isBanned) {
    return NextResponse.json(
      { error: "Cet utilisateur est introuvable ou a été banni." },
      { status: 400 },
    );
  }

  const existingMembership = await prisma.membership.findUnique({
    where: { userId_tontineSessionId: { userId, tontineSessionId } },
  });
  if (existingMembership?.status === "BANNED") {
    return NextResponse.json(
      { error: "Impossible d'ajouter ce membre : il a été banni de cette cotisation." },
      { status: 409 },
    );
  }

  const finesCheck = await checkUserFinesForJoining(userId, tontineSessionId);
  if (!finesCheck.canJoin) {
    return NextResponse.json(
      { error: `Impossible d'ajouter ce membre : il a des amendes impayées (${finesCheck.totalUnpaidAmount.toLocaleString()} FCFA) à finaliser avant d'intégrer une nouvelle cotisation.` },
      { status: 409 },
    );
  }

  const existingSlots = await prisma.membershipSlot.findMany({
    where: { membership: { tontineSessionId } },
    select: { beneficiaryName: true },
  });
  const finalNames = resolveUniqueSlotNames(
    existingSlots.map((s) => s.beneficiaryName),
    beneficiaryNames,
  );

  const isStarted = tontineSession.status !== "DRAFT";

  try {
    const {
      membership: createdMembership,
      assignedPositions,
      isAppend,
    } = await prisma.$transaction(async (tx) => {
      const currentApprovedSlots = await tx.membershipSlot.findMany({
        where: { membership: { tontineSessionId, status: "APPROVED" } },
        select: { id: true, officialPosition: true },
      });

      const maxOfficialPos = currentApprovedSlots.reduce(
        (max, s) => Math.max(max, s.officialPosition ?? 0),
        0,
      );

      // Si la cotisation a déjà commencé (DRAWING ou ACTIVE), les nouveaux noms prennent
      // obligatoirement les dernières places à la fin de l'ordre de bouffe.
      const startPos = isStarted
        ? Math.max(maxOfficialPos, currentApprovedSlots.length) + 1
        : maxOfficialPos > 0
          ? maxOfficialPos + 1
          : null;

      const isAlreadyApproved = existingMembership?.status === "APPROVED";
      let existingMemberSlotsCount = 0;

      if (existingMembership && !isAlreadyApproved) {
        await tx.membershipSlot.deleteMany({
          where: { membershipId: existingMembership.id },
        });
        await tx.kycVerification.updateMany({
          where: { membershipId: existingMembership.id },
          data: { status: "VERIFIED", verifiedAt: new Date() },
        });
      } else if (existingMembership && isAlreadyApproved) {
        existingMemberSlotsCount = await tx.membershipSlot.count({
          where: { membershipId: existingMembership.id },
        });
      }

      const newMemberSlotCount = existingMemberSlotsCount + finalNames.length;

      const membership = existingMembership
        ? await tx.membership.update({
            where: { id: existingMembership.id },
            data: {
              status: "APPROVED",
              rejectionReason: null,
              slotCount: newMemberSlotCount,
            },
          })
        : await tx.membership.create({
            data: {
              userId,
              tontineSessionId,
              status: "APPROVED",
              slotCount: newMemberSlotCount,
            },
          });

      const positions: number[] = [];
      await tx.membershipSlot.createMany({
        data: finalNames.map((beneficiaryName, idx) => {
          const pos = startPos !== null ? startPos + idx : null;
          if (pos !== null) positions.push(pos);
          return {
            membershipId: membership.id,
            beneficiaryName,
            officialPosition: pos,
            ballDrawn: isStarted && pos !== null ? pos : null,
          };
        }),
      });

      const newTotalApprovedSlots = currentApprovedSlots.length + finalNames.length;
      if (
        tontineSession.maxSlots !== null &&
        newTotalApprovedSlots > Number(tontineSession.maxSlots)
      ) {
        await tx.tontineSession.update({
          where: { id: tontineSessionId },
          data: { maxSlots: newTotalApprovedSlots },
        });
      }

      return {
        membership,
        assignedPositions: positions,
        isAppend: isAlreadyApproved && existingMemberSlotsCount > 0,
      };
    });

    await ensureMemberCode(userId);

    const userFirstName = targetUser.name.trim().split(/\s+/)[0] || targetUser.name;
    const sessionTitle =
      tontineSession.title?.trim() ||
      TONTINE_TYPE_LABELS[tontineSession.type] ||
      tontineSession.type;
    const lang = targetUser.preferredLang === "en" ? "en" : "fr";

    const positionsLabel =
      assignedPositions.length > 0
        ? assignedPositions.map((p) => `#${p}`).join(", ")
        : null;

    const message =
      isStarted && positionsLabel
        ? lang === "en"
          ? `Hello ${userFirstName} 👋! Your name(s) (${finalNames.join(", ")}) have been added to ${sessionTitle} at the end of the payout order (${positionsLabel}).`
          : `Bonjour ${userFirstName} 👋 ! Vos nom(s) (${finalNames.join(", ")}) ont été ajoutés dans la cotisation « ${sessionTitle} » en fin d'ordre de bouffe (place ${positionsLabel}).`
        : translate(lang, "memberApprovedMessage", {
            name: userFirstName,
            session: sessionTitle,
          });

    await scheduleInAppNotifications({
      tontineSessionId,
      type: "MEMBER_APPROVED",
      recipients: [
        {
          userId,
          message,
          ...(isStarted && positionsLabel
            ? {}
            : {
                messageKey: "memberApprovedMessage",
                messageVars: { name: userFirstName, session: sessionTitle },
              }),
          actionUrl: `/sessions/${tontineSessionId}`,
        },
      ],
    });

    await logAudit({
      actorId: admin.user.id,
      actorRole: admin.user.role,
      action: "member_approved",
      targetType: "Membership",
      targetId: createdMembership.id,
      tontineSessionId,
      request,
      payloadAfter: {
        status: "APPROVED",
        addedSlotCount: slotCount,
        totalMemberSlotCount: createdMembership.slotCount,
        finalNames,
        assignedPositions,
      },
      metadata: {
        userId,
        manual: true,
        addedAfterStart: isStarted,
        isAppend,
      },
    });

    return NextResponse.json({
      ok: true,
      beneficiaryNames: finalNames,
      assignedPositions,
      isAppend,
    });
  } catch (err) {
    console.error("[admin/memberships/manual] unexpected error:", err);
    return NextResponse.json({ error: "Could not add this member. Please try again." }, { status: 500 });
  }
}
