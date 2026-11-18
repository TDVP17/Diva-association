import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/constants";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import { formatXAF } from "@/lib/format-currency";
import { logAudit } from "@/lib/audit";
import { getPrivateTontineConfig } from "@/lib/private-tontine-config";

const upsertFundSchema = z.object({
  name: z.string().trim().min(2, "Nom requis").max(100),
  minimumAmount: z.number().int().min(100, "Montant minimum : 100 FCFA").max(10_000_000),
  frequency: z.string().trim().max(60).optional(),
  description: z.string().trim().max(500).optional(),
  rules: z.string().trim().max(1000).optional(),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const { id } = await context.params;
  const userId = session.user.id;

  const tontine = await prisma.tontineSession.findUnique({
    where: { id },
    include: {
      emergencyFund: {
        include: {
          contributions: {
            include: { user: { select: { id: true, name: true } } },
            orderBy: { createdAt: "desc" },
          },
        },
      },
      memberships: {
        where: { status: "APPROVED" },
        include: { user: { select: { id: true, name: true, phone: true } } },
      },
    },
  });

  if (!tontine || !tontine.isPrivate || tontine.softDeletedAt !== null) {
    return NextResponse.json({ error: "Cotisation privée introuvable." }, { status: 404 });
  }

  const isMember = tontine.memberships.some((m) => m.userId === userId);
  const isOwnerOrAdmin = tontine.creatorId === userId || isAdminRole(session.user.role);
  if (!isMember && !isOwnerOrAdmin) {
    return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
  }

  if (!tontine.emergencyFund) {
    return NextResponse.json({ fund: null });
  }

  const fund = tontine.emergencyFund;
  const minAmount = Number(fund.minimumAmount);
  const paidByUser = new Map<string, number>();
  for (const c of fund.contributions) {
    if (c.status === "COMPLETED") {
      paidByUser.set(c.userId, (paidByUser.get(c.userId) ?? 0) + Number(c.amount));
    }
  }

  const memberStatuses = tontine.memberships.map((m) => {
    const contributed = paidByUser.get(m.userId) ?? 0;
    return {
      userId: m.userId,
      userName: m.user.name,
      contributed,
      hasPaidMinimum: contributed >= minAmount,
      remaining: Math.max(0, minAmount - contributed),
    };
  });

  const totalCollected = Array.from(paidByUser.values()).reduce((s, v) => s + v, 0);
  const totalExpected = minAmount * tontine.memberships.length;

  return NextResponse.json({
    fund: {
      id: fund.id,
      name: fund.name,
      description: fund.description,
      minimumAmount: minAmount,
      frequency: fund.frequency,
      rules: fund.rules,
      isActive: fund.isActive,
      totalBalance: totalCollected,
      totalCollected,
      totalExpected,
      paidParticipants: memberStatuses.filter((m) => m.hasPaidMinimum),
      unpaidParticipants: memberStatuses.filter((m) => !m.hasPaidMinimum),
      memberStatuses,
      contributions: fund.contributions.map((c) => ({
        id: c.id,
        userId: c.userId,
        userName: c.user.name,
        amount: Number(c.amount),
        paymentMethod: c.paymentMethod,
        status: c.status,
        createdAt: c.createdAt.toISOString(),
      })),
    },
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const { id } = await context.params;
  const userId = session.user.id;

  const adminConfig = await getPrivateTontineConfig();
  const allowedEmergencyFund = adminConfig.actions.some(
    (a) => a.key === "allow_emergency_fund" && a.enabledByAdmin,
  );
  if (!allowedEmergencyFund && !isAdminRole(session.user.role)) {
    return NextResponse.json(
      { error: "La caisse de secours est actuellement désactivée par l'administrateur DIVA Asso." },
      { status: 403 },
    );
  }

  const tontine = await prisma.tontineSession.findUnique({
    where: { id },
    include: {
      emergencyFund: true,
      memberships: {
        where: { status: "APPROVED" },
        include: { user: { select: { id: true, name: true } } },
      },
    },
  });

  if (!tontine || !tontine.isPrivate || tontine.softDeletedAt !== null) {
    return NextResponse.json({ error: "Cotisation privée introuvable." }, { status: 404 });
  }
  if (tontine.creatorId !== userId && !isAdminRole(session.user.role)) {
    return NextResponse.json({ error: "Seul le propriétaire peut créer la caisse de secours." }, { status: 403 });
  }
  if (tontine.emergencyFund) {
    return NextResponse.json({ error: "Une caisse de secours existe déjà pour cette cotisation." }, { status: 409 });
  }

  const body = await request.json().catch(() => null);
  const parsed = upsertFundSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Données invalides." },
      { status: 400 },
    );
  }

  const fund = await prisma.privateEmergencyFund.create({
    data: {
      tontineSessionId: tontine.id,
      name: parsed.data.name,
      minimumAmount: parsed.data.minimumAmount,
      frequency: parsed.data.frequency || null,
      description: parsed.data.description || null,
      rules: parsed.data.rules || null,
      isActive: true,
    },
  });

  // Notify ONLY the approved members of THIS private cotisation with the required minimum amount
  if (tontine.memberships.length > 0) {
    await scheduleInAppNotifications({
      tontineSessionId: tontine.id,
      type: "ADMIN_BROADCAST",
      recipients: tontine.memberships.map((m) => ({
        userId: m.userId,
        message: `Caisse de secours « ${fund.name} » activée pour « ${tontine.title} » ! Montant minimum requis par participant : ${formatXAF(parsed.data.minimumAmount)}.`,
        actionUrl: "/private-tontines",
      })),
    }).catch(() => {});
  }

  await logAudit({
    actorId: userId,
    actorRole: session.user.role,
    action: "private_emergency_fund_created",
    targetType: "PrivateEmergencyFund",
    targetId: fund.id,
    tontineSessionId: tontine.id,
    metadata: { name: fund.name, minimumAmount: parsed.data.minimumAmount },
    request,
  });

  return NextResponse.json({ ok: true, fund }, { status: 201 });
}

