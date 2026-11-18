import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import type { TontineType } from "@/generated/prisma/client";

const ALLOWED_TYPES: TontineType[] = [
  "HEBDO_SUNDAY",
  "EVERY_MONDAY",
  "EVERY_TUESDAY",
  "EVERY_WEDNESDAY",
  "EVERY_THURSDAY",
  "EVERY_FRIDAY",
  "EVERY_SATURDAY",
  "BIWEEKLY_SUNDAY",
  "BIWEEKLY_MONDAY",
  "BIWEEKLY_TUESDAY",
  "BIWEEKLY_WEDNESDAY",
  "BIWEEKLY_THURSDAY",
  "BIWEEKLY_FRIDAY",
  "BIWEEKLY_SATURDAY",
  "MONTHLY_1",
  "MONTHLY_5",
  "MONTHLY_10",
  "MONTHLY_15",
  "MONTHLY_20",
  "MONTHLY_25",
  "MONTHLY_28",
  "QUARTERLY_25",
];

const createPrivateTontineSchema = z.object({
  title: z.string().trim().min(3, "Le titre doit contenir au moins 3 caractères").max(100),
  description: z.string().trim().max(500).optional(),
  type: z.enum(ALLOWED_TYPES as [TontineType, ...TontineType[]]),
  amount: z.number().int().min(1000, "Mise minimale : 1 000 FCFA").max(5_000_000),
  fee: z.number().int().min(0).max(500_000).default(0),
  startDate: z.string().min(1),
  limitTime: z.string().regex(/^\d{2}:\d{2}$/, "Format HH:MM requis").default("18:30"),
  maxSlots: z.number().int().min(2).max(100).nullable().optional(),
  fineAmountPerPeriod: z.number().int().min(0).max(100_000).optional(),
  fineIntervalHours: z.number().int().min(1).max(168).optional(),
  rulesAccepted: z.literal(true, {
    error: "Vous devez lire et accepter les règles des cotisations privées DIVA Asso avant de créer votre cotisation.",
  }),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const userId = session.user.id;

  const tontines = await prisma.tontineSession.findMany({
    where: {
      isPrivate: true,
      OR: [
        { creatorId: userId },
        { memberships: { some: { userId } } },
      ],
    },
    include: {
      creator: { select: { id: true, name: true } },
      memberships: {
        include: {
          user: { select: { id: true, name: true, phone: true, email: true } },
          slots: {
            orderBy: { officialPosition: "asc" },
          },
        },
        orderBy: { joinedAt: "asc" },
      },
    },
    orderBy: { startDate: "desc" },
  });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://divaasso.com";

  return NextResponse.json({
    tontines: tontines.map((t) => {
      const isApprovedByAdmin = t.privateApprovalStatus === "APPROVED";
      return {
        id: t.id,
        title: t.title,
        description: t.description,
        type: t.type,
        amount: Number(t.amount),
        fee: Number(t.fee),
        status: t.status,
        isPaused: t.isPaused,
        isLocked: t.lockedAt !== null,
        privateApprovalStatus: t.privateApprovalStatus,
        privateRejectionReason: t.privateRejectionReason,
        startDate: t.startDate.toISOString(),
        limitTime: t.limitTime,
        maxSlots: t.maxSlots ? Number(t.maxSlots) : null,
        fineAmountPerPeriod: t.fineAmountPerPeriod ? Number(t.fineAmountPerPeriod) : 500,
        fineIntervalHours: t.fineIntervalHours ?? 24,
        inviteToken: isApprovedByAdmin ? t.inviteToken : null,
        inviteUrl: isApprovedByAdmin && t.inviteToken ? `${baseUrl}/join/${t.inviteToken}` : null,
        isCreator: t.creatorId === userId,
        creatorName: t.creator?.name ?? "DIVA Asso",
        pendingCount: t.memberships.filter((m) => m.status === "PENDING").length,
        approvedCount: t.memberships.filter((m) => m.status === "APPROVED").length,
        memberships: t.memberships.map((m) => ({
          id: m.id,
          userId: m.userId,
          userName: m.user.name,
          userPhone: m.user.phone,
          status: m.status,
          slotCount: m.slotCount,
          joinedAt: m.joinedAt.toISOString(),
          slots: m.slots.map((s) => ({
            id: s.id,
            beneficiaryName: s.beneficiaryName,
            officialPosition: s.officialPosition,
            ballDrawn: s.ballDrawn,
          })),
        })),
      };
    }),
  });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const userId = session.user.id;

  const body = await request.json().catch(() => null);
  const parsed = createPrivateTontineSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Données invalides" },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const startDate = new Date(data.startDate);
  if (Number.isNaN(startDate.getTime())) {
    return NextResponse.json({ error: "Date de début invalide" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, isBanned: true },
  });
  if (!user || user.isBanned) {
    return NextResponse.json({ error: "Compte non autorisé" }, { status: 403 });
  }

  // Create in PENDING_ADMIN with NO inviteToken yet — Admin must approve before invite link is generated!
  const created = await prisma.$transaction(async (tx) => {
    const tontine = await tx.tontineSession.create({
      data: {
        title: data.title,
        description: data.description || null,
        type: data.type,
        amount: data.amount,
        fee: data.fee,
        status: "DRAFT",
        startDate,
        limitTime: data.limitTime,
        maxSlots: data.maxSlots ?? null,
        fineAmountPerPeriod: data.fineAmountPerPeriod ?? 500,
        fineIntervalHours: data.fineIntervalHours ?? 24,
        isPrivate: true,
        inviteToken: null,
        creatorId: userId,
        privateApprovalStatus: "PENDING_ADMIN",
        privateRulesAcceptedAt: new Date(),
      },
    });

    const membership = await tx.membership.create({
      data: {
        userId,
        tontineSessionId: tontine.id,
        status: "APPROVED",
        slotCount: 1,
      },
    });

    await tx.membershipSlot.create({
      data: {
        membershipId: membership.id,
        beneficiaryName: user.name,
        officialPosition: 1,
        ballDrawn: 1,
      },
    });

    return tontine;
  });

  // Immediately notify all Admins to review and approve this private cotisation
  const admins = await prisma.user.findMany({
    where: { role: { in: ["ADMIN", "PRESIDENT"] }, isBanned: false },
    select: { id: true },
  });
  if (admins.length > 0) {
    await scheduleInAppNotifications({
      tontineSessionId: created.id,
      type: "ADMIN_BROADCAST",
      recipients: admins.map((a) => ({
        userId: a.id,
        message: `🔒 Nouvelle cotisation privée à valider : « ${created.title} » créée par ${user.name} (${Number(created.amount).toLocaleString("fr-FR")} FCFA). Validez pour générer son lien d'invitation.`,
        actionUrl: "/admin/private-tontines",
      })),
    }).catch(() => {});
  }

  await logAudit({
    actorId: userId,
    actorRole: session.user.role,
    action: "private_tontine_submitted_for_admin_approval",
    targetType: "TontineSession",
    targetId: created.id,
    tontineSessionId: created.id,
    metadata: { title: created.title, amount: Number(created.amount), isPrivate: true },
    request,
  });

  return NextResponse.json(
    {
      ok: true,
      id: created.id,
      privateApprovalStatus: "PENDING_ADMIN",
      message:
        "Votre cotisation privée a été créée et envoyée à l'administrateur DIVA Asso pour validation. Votre lien d'invitation sera généré dès son approbation !",
    },
    { status: 201 },
  );
}
