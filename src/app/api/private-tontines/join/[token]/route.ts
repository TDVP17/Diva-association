import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import { logAudit } from "@/lib/audit";

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  if (!token || token.length < 6) {
    return NextResponse.json({ error: "Lien d'invitation invalide" }, { status: 400 });
  }

  const tontine = await prisma.tontineSession.findUnique({
    where: { inviteToken: token },
    include: {
      creator: { select: { id: true, name: true } },
      memberships: {
        select: { id: true, userId: true, status: true, slotCount: true },
      },
    },
  });

  if (!tontine || !tontine.isPrivate || tontine.privateApprovalStatus !== "APPROVED" || tontine.softDeletedAt !== null) {
    return NextResponse.json({ error: "Cotisation privée introuvable ou non encore validée" }, { status: 404 });
  }

  const session = await auth();
  const existingMembership = session?.user?.id
    ? tontine.memberships.find((m) => m.userId === session.user.id)
    : null;

  const approvedCount = tontine.memberships.filter((m) => m.status === "APPROVED").length;

  return NextResponse.json({
    id: tontine.id,
    title: tontine.title,
    description: tontine.description,
    type: tontine.type,
    amount: Number(tontine.amount),
    fee: Number(tontine.fee),
    status: tontine.status,
    startDate: tontine.startDate.toISOString(),
    limitTime: tontine.limitTime,
    maxSlots: tontine.maxSlots ? Number(tontine.maxSlots) : null,
    creatorName: tontine.creator?.name ?? "DIVA Asso",
    approvedMembersCount: approvedCount,
    isClosed: tontine.status === "CLOSED",
    isPaused: tontine.isPaused,
    isLocked: tontine.lockedAt !== null,
    myMembershipStatus: existingMembership?.status ?? null,
    isSignedIn: Boolean(session?.user?.id),
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Veuillez vous connecter pour rejoindre cette tontine." }, { status: 401 });
  }
  const userId = session.user.id;
  const { token } = await context.params;

  const body = await request.json().catch(() => ({}));
  if (body?.disclaimerAccepted !== true) {
    return NextResponse.json(
      {
        error:
          "Vous devez lire et accepter la clause de non-responsabilité DIVA Asso avant de pouvoir intégrer cette cotisation privée.",
      },
      { status: 400 },
    );
  }

  const tontine = await prisma.tontineSession.findUnique({
    where: { inviteToken: token },
    include: {
      memberships: {
        select: { id: true, userId: true, status: true, slotCount: true },
      },
    },
  });

  if (!tontine || !tontine.isPrivate || tontine.privateApprovalStatus !== "APPROVED" || tontine.softDeletedAt !== null) {
    return NextResponse.json({ error: "Lien d'invitation invalide, expiré ou non encore validé par DIVA Asso." }, { status: 404 });
  }

  if (tontine.status === "CLOSED") {
    return NextResponse.json({ error: "Cette tontine privée est déjà clôturée." }, { status: 400 });
  }
  if (tontine.isPaused || tontine.lockedAt) {
    return NextResponse.json({ error: "Les inscriptions à cette tontine sont actuellement fermées." }, { status: 400 });
  }

  const existing = tontine.memberships.find((m) => m.userId === userId);
  if (existing) {
    if (existing.status === "BANNED") {
      return NextResponse.json({ error: "Votre accès à cette tontine a été révoqué." }, { status: 403 });
    }
    if (existing.status === "APPROVED") {
      return NextResponse.json({ ok: true, alreadyMember: true, sessionId: tontine.id });
    }
    if (existing.status === "PENDING") {
      return NextResponse.json({ ok: true, status: "PENDING", message: "Votre demande est déjà en attente de validation par le gestionnaire." });
    }
  }

  // Check maxSlots capacity
  if (tontine.maxSlots) {
    const usedSlots = tontine.memberships
      .filter((m) => m.status === "APPROVED" || m.status === "PENDING")
      .reduce((sum, m) => sum + (m.slotCount ?? 1), 0);
    if (usedSlots >= Number(tontine.maxSlots)) {
      return NextResponse.json({ error: "Cette tontine privée a atteint le nombre maximum de places." }, { status: 409 });
    }
  }

  const membership = existing
    ? await prisma.membership.update({
        where: { id: existing.id },
        data: {
          status: "PENDING",
          rejectionReason: null,
          joinedAt: new Date(),
          disclaimerAcceptedAt: new Date(),
        },
      })
    : await prisma.membership.create({
        data: {
          userId,
          tontineSessionId: tontine.id,
          status: "PENDING",
          disclaimerAcceptedAt: new Date(),
        },
      });

  // Notify creator
  if (tontine.creatorId && tontine.creatorId !== userId) {
    await scheduleInAppNotifications({
      tontineSessionId: tontine.id,
      type: "NEW_MEMBERSHIP_REQUEST",
      recipients: [
        {
          userId: tontine.creatorId,
          message: `${session.user.name || "Un membre"} demande à rejoindre votre tontine privée « ${tontine.title || "Tontine privée"} ».`,
          actionUrl: `/private-tontines`,
        },
      ],
    }).catch((err) => console.error("[private-tontines/join] notify creator error:", err));
  }

  await logAudit({
    actorId: userId,
    actorRole: session.user.role,
    action: "private_tontine_join_requested",
    targetType: "Membership",
    targetId: membership.id,
    tontineSessionId: tontine.id,
    request,
  });

  return NextResponse.json({
    ok: true,
    status: "PENDING",
    sessionId: tontine.id,
    message: "Votre demande d'adhésion a été envoyée au gestionnaire de la tontine privée !",
  });
}
