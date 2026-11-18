import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import { logAudit } from "@/lib/audit";

/**
 * Allows a participant to leave a private cotisation cleanly under Section 9 rules:
 * - The creator CANNOT leave while holding the owner role (must transfer ownership first).
 * - Regular participants CAN leave ONLY before official start (status === "DRAFT") or on a restarted cycle before start.
 * - Blocked once ACTIVE/DRAWING to protect group financial commitments.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id } = await context.params;

  const tontine = await prisma.tontineSession.findUnique({
    where: { id },
    include: {
      memberships: { where: { userId } },
    },
  });

  if (!tontine || !tontine.isPrivate || tontine.softDeletedAt !== null) {
    return NextResponse.json({ error: "Cotisation privée introuvable." }, { status: 404 });
  }

  if (tontine.creatorId === userId) {
    return NextResponse.json(
      {
        error:
          "En tant que propriétaire, vous ne pouvez pas quitter le groupe sans transférer d'abord la gestion à un autre membre validé.",
      },
      { status: 403 },
    );
  }

  const membership = tontine.memberships[0];
  if (!membership) {
    return NextResponse.json({ error: "Vous ne faites pas partie de cette cotisation." }, { status: 404 });
  }

  if (tontine.status !== "DRAFT") {
    return NextResponse.json(
      {
        error:
          "Vous ne pouvez plus quitter cette cotisation une fois qu'elle a démarré. Vous pourrez quitter librement avant le début du prochain cycle.",
      },
      { status: 409 },
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.membershipSlot.deleteMany({ where: { membershipId: membership.id } });
    await tx.membership.delete({ where: { id: membership.id } });
  });

  if (tontine.creatorId) {
    await scheduleInAppNotifications({
      tontineSessionId: tontine.id,
      type: "ADMIN_BROADCAST",
      recipients: [
        {
          userId: tontine.creatorId,
          message: `${session.user.name || "Un membre"} a quitté votre cotisation privée « ${tontine.title} » avant son démarrage.`,
          actionUrl: "/private-tontines",
        },
      ],
    }).catch(() => {});
  }

  await logAudit({
    actorId: userId,
    actorRole: session.user.role,
    action: "private_tontine_member_left",
    targetType: "TontineSession",
    targetId: tontine.id,
    tontineSessionId: tontine.id,
    request,
  });

  return NextResponse.json({ ok: true, message: "Vous avez quitté cette cotisation privée." });
}

