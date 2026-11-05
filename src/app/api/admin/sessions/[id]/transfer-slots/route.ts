import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { logAudit } from "@/lib/audit";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";

const transferSchema = z.object({
  slotIds: z.array(z.string().min(1)).min(1, "Au moins une part doit être sélectionnée"),
  targetEmail: z.string().trim().email("Adresse email invalide"),
  newBeneficiaryNames: z.record(z.string(), z.string()).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: tontineSessionId } = await params;
  const tontineSession = await prisma.tontineSession.findUnique({
    where: { id: tontineSessionId },
    select: { id: true, title: true, type: true, status: true },
  });

  if (!tontineSession) {
    return NextResponse.json({ error: "Session introuvable" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = transferSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]?.message ?? "Données invalides";
    return NextResponse.json({ error: issue }, { status: 400 });
  }

  const { slotIds, targetEmail, newBeneficiaryNames } = parsed.data;
  const cleanEmail = targetEmail.toLowerCase();

  // 1. Find the target user by email
  const targetUser = await prisma.user.findFirst({
    where: { email: { equals: cleanEmail, mode: "insensitive" } },
    select: { id: true, name: true, email: true, role: true, isBanned: true },
  });

  if (!targetUser) {
    return NextResponse.json(
      {
        error: `Aucun compte n'a été trouvé avec l'email "${targetEmail}". Votre cousine / destinataire doit d'abord créer son compte sur l'application avec cet email pour recevoir ses parts.`,
      },
      { status: 404 },
    );
  }

  if (targetUser.isBanned) {
    return NextResponse.json(
      { error: `Le compte associé à ${targetEmail} est actuellement banni.` },
      { status: 400 },
    );
  }

  // 2. Load the requested slots and verify they belong to this session
  const slots = await prisma.membershipSlot.findMany({
    where: { id: { in: slotIds } },
    include: {
      membership: {
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });

  if (slots.length !== slotIds.length) {
    return NextResponse.json(
      { error: "Certaines parts sélectionnées sont introuvables." },
      { status: 400 },
    );
  }

  const invalidSessionSlot = slots.find((s) => s.membership.tontineSessionId !== tontineSessionId);
  if (invalidSessionSlot) {
    return NextResponse.json(
      { error: "Une ou plusieurs parts n'appartiennent pas à cette cotisation." },
      { status: 400 },
    );
  }

  // Filter slots that actually need transfer (not already owned by target)
  const slotsToTransfer = slots.filter((s) => s.membership.userId !== targetUser.id);
  if (slotsToTransfer.length === 0) {
    return NextResponse.json(
      { error: `Toutes les parts sélectionnées sont déjà attribuées au compte de ${targetUser.name} (${targetUser.email}).` },
      { status: 400 },
    );
  }

  // Group source memberships to calculate slot count reductions
  const sourceCountMap = new Map<string, number>();
  const sourceUserMap = new Map<string, { id: string; name: string; email: string | null; slotNames: string[] }>();

  for (const s of slotsToTransfer) {
    sourceCountMap.set(s.membershipId, (sourceCountMap.get(s.membershipId) || 0) + 1);
    const u = s.membership.user;
    if (!sourceUserMap.has(u.id)) {
      sourceUserMap.set(u.id, { id: u.id, name: u.name, email: u.email, slotNames: [] });
    }
    sourceUserMap.get(u.id)!.slotNames.push(s.beneficiaryName);
  }

  // 3. Execute transfer inside a single atomic transaction
  await prisma.$transaction(async (tx) => {
    // 3.1 Find or create target membership in this session
    let targetMembership = await tx.membership.findUnique({
      where: {
        userId_tontineSessionId: {
          userId: targetUser.id,
          tontineSessionId,
        },
      },
    });

    if (!targetMembership) {
      targetMembership = await tx.membership.create({
        data: {
          userId: targetUser.id,
          tontineSessionId,
          status: "APPROVED",
          slotCount: slotsToTransfer.length,
          joinedAt: new Date(),
        },
      });
    } else {
      targetMembership = await tx.membership.update({
        where: { id: targetMembership.id },
        data: {
          status: "APPROVED",
          slotCount: (targetMembership.slotCount || 0) + slotsToTransfer.length,
        },
      });
    }

    // 3.2 Decrement slotCount on source memberships
    for (const [sourceMemId, count] of sourceCountMap) {
      const sourceMem = await tx.membership.findUnique({
        where: { id: sourceMemId },
        select: { slotCount: true },
      });
      if (sourceMem) {
        await tx.membership.update({
          where: { id: sourceMemId },
          data: {
            slotCount: Math.max(0, (sourceMem.slotCount || 0) - count),
          },
        });
      }
    }

    // 3.3 Reassign each slot to target membership (preserving position, draw, contributions, fines, payouts)
    for (const slot of slotsToTransfer) {
      const customName = newBeneficiaryNames?.[slot.id]?.trim();
      await tx.membershipSlot.update({
        where: { id: slot.id },
        data: {
          membershipId: targetMembership.id,
          ...(customName ? { beneficiaryName: customName } : {}),
        },
      });
    }
  });

  // 4. Log audit trail
  const sessionName = tontineSession.title || "Cotisation";
  await logAudit({
    actorId: admin.user.id,
    actorRole: admin.user.role,
    action: "TRANSFER_MEMBERSHIP_SLOTS",
    targetType: "MEMBERSHIP_SLOT",
    targetId: targetUser.id,
    tontineSessionId,
    metadata: {
      targetUserId: targetUser.id,
      targetUserEmail: targetUser.email,
      targetUserName: targetUser.name,
      transferredSlotsCount: slotsToTransfer.length,
      transferredSlotIds: slotsToTransfer.map((s) => s.id),
      transferredSlotNames: slotsToTransfer.map((s) => s.beneficiaryName),
      sources: Array.from(sourceUserMap.values()).map((src) => ({
        userId: src.id,
        name: src.name,
        email: src.email,
        transferredSlots: src.slotNames,
      })),
    },
  });

  // 5. Notify both parties in-app + web push + email
  // Notify target user (la cousine)
  try {
    await scheduleInAppNotifications({
      tontineSessionId,
      type: "MEMBER_APPROVED",
      recipients: [
        {
          userId: targetUser.id,
          message: `L'administrateur vous a attribué ${slotsToTransfer.length} part(s) de cotisation (${slotsToTransfer.map((s) => s.beneficiaryName).join(", ")}) dans la tontine "${sessionName}". Rendez-vous dans votre espace pour la gérer !`,
          actionUrl: `/sessions/${tontineSessionId}`,
        },
      ],
    });
  } catch (err) {
    console.error("[transfer-slots] notify target error:", err);
  }

  // Notify each source user
  for (const src of sourceUserMap.values()) {
    try {
      await scheduleInAppNotifications({
        tontineSessionId,
        type: "MEMBER_APPROVED",
        recipients: [
          {
            userId: src.id,
            message: `Vos parts de cotisation (${src.slotNames.join(", ")}) ont été transférées avec succès vers le compte de ${targetUser.name} (${targetUser.email}). Elles sont désormais gérées directement par ce compte.`,
            actionUrl: `/sessions/${tontineSessionId}`,
          },
        ],
      });
    } catch (err) {
      console.error("[transfer-slots] notify source error:", err);
    }
  }

  return NextResponse.json({
    ok: true,
    transferredCount: slotsToTransfer.length,
    targetUser: {
      id: targetUser.id,
      name: targetUser.name,
      email: targetUser.email,
    },
    message: `${slotsToTransfer.length} part(s) transférée(s) avec succès à ${targetUser.name} (${targetUser.email}).`,
  });
}
