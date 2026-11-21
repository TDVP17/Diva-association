import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import { sendEmailSafe } from "@/lib/email/resend";
import { renderBrandedEmailHtml } from "@/lib/email/template";
import { getPrivateTontineConfig } from "@/lib/private-tontine-config";
import { isStartDateValidForCycle } from "@/lib/cycle-date-validation";
import {
  calculatePrivatePlatformFee,
  calculateAdditionalFeeSplit,
  evaluatePrivateLaunchReadiness,
} from "@/lib/private-tontine-finance";
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
  amount: z.number().int().min(500, "Mise trop faible").max(50_000_000),
  fee: z.number().int().min(0).max(500_000).default(0),
  startDate: z.string().min(1),
  limitTime: z.string().regex(/^\d{2}:\d{2}$/, "Format HH:MM requis").default("18:30"),
  maxSlots: z.number().int().min(2).max(500).nullable().optional(),
  fineAmountPerPeriod: z.number().int().min(0).max(100_000).optional(),
  fineIntervalHours: z.number().int().min(1).max(168).optional(),
  creatorParticipates: z.boolean().default(true),
  creatorFullName: z.string().trim().min(3, "Veuillez renseigner votre nom complet."),
  creatorPhotoUrl: z.string().min(1, "Veuillez fournir votre photo de profil / portrait."),
  creatorIdDocUrl: z.string().min(1, "Veuillez fournir votre pièce d'identité (CNI / Récépissé / Passeport)."),
  guarantorId: z.string().min(1, "Veuillez sélectionner un garant inscrit dans une cotisation publique."),
  privateAdditionalFeePayoutPct: z.number().int().min(0).max(100).default(100),
  privatePenaltyBeneficiaryPct: z.number().int().min(0).max(100).default(100),
  selectedActions: z.array(z.string().max(80)).max(30).optional(),
  emergencyFund: z
    .object({
      enabled: z.boolean(),
      name: z.string().trim().min(2).max(100).optional(),
      minimumAmount: z.number().int().min(100).max(10_000_000).optional(),
      frequency: z.string().trim().max(60).optional(),
      description: z.string().trim().max(500).optional(),
      rules: z.string().trim().max(1000).optional(),
    })
    .optional(),
  rulesAccepted: z.literal(true, {
    error: "Vous devez lire et accepter les règles des cotisations privées DIVA Asso avant de soumettre votre cotisation.",
  }),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const userId = session.user.id;

  const [tontines, adminConfig] = await Promise.all([
    prisma.tontineSession.findMany({
      where: {
        isPrivate: true,
        softDeletedAt: null,
        OR: [
          { creatorId: userId },
          { memberships: { some: { userId } } },
        ],
      },
      include: {
        creator: { select: { id: true, name: true } },
        emergencyFund: {
          include: {
            contributions: {
              include: { user: { select: { id: true, name: true } } },
              orderBy: { createdAt: "desc" },
            },
          },
        },
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
    }),
    getPrivateTontineConfig(),
  ]);

  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://divaasso.com").replace(
    /^https?:\/\/www\.divaasso\.com/i,
    "https://divaasso.com",
  );

  return NextResponse.json({
    tontines: tontines.map((t) => {
      const isApprovedByAdmin = t.privateApprovalStatus === "APPROVED";
      const approvedMembersCount = t.memberships.filter((m) => m.status === "APPROVED").length;
      const minParticipants = t.privateMinParticipants ?? adminConfig.minSlots;
      const launchReadiness = evaluatePrivateLaunchReadiness({
        approvedMembersCount,
        minParticipants,
        startDate: t.startDate,
      });
      const estimatedCycles = Math.max(
        approvedMembersCount,
        t.maxSlots ? Number(t.maxSlots) : minParticipants,
      );
      const platformFee = calculatePrivatePlatformFee(Number(t.amount), estimatedCycles);
      const additionalSplit = calculateAdditionalFeeSplit(
        Number(t.fee),
        t.privateAdditionalFeePayoutPct ?? 100,
      );

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
        creatorParticipates: t.creatorParticipates,
        privateMinParticipants: minParticipants,
        privateAdditionalFeePayoutPct: t.privateAdditionalFeePayoutPct ?? 100,
        privatePenaltyBeneficiaryPct: t.privatePenaltyBeneficiaryPct ?? 100,
        privateFinancialRulesLockedAt: t.privateFinancialRulesLockedAt?.toISOString() ?? null,
        parentSessionId: t.parentSessionId,
        privateApprovalStatus: t.privateApprovalStatus,
        privateRejectionReason: t.privateRejectionReason,
        privateConfig: (t.privateConfig as { selectedActions?: string[] } | null) ?? null,
        launchReadiness,
        platformFee,
        additionalSplit,
        startDate: t.startDate.toISOString(),
        limitTime: t.limitTime,
        maxSlots: t.maxSlots ? Number(t.maxSlots) : null,
        fineAmountPerPeriod: t.fineAmountPerPeriod ? Number(t.fineAmountPerPeriod) : 0,
        fineIntervalHours: t.fineIntervalHours ?? 24,
        inviteToken: isApprovedByAdmin ? t.inviteToken : null,
        inviteUrl: isApprovedByAdmin && t.inviteToken ? `${baseUrl}/join/${t.inviteToken}` : null,
        isCreator: t.creatorId === userId,
        creatorName: t.creator?.name ?? "DIVA Asso",
        pendingCount: t.memberships.filter((m) => m.status === "PENDING").length,
        approvedCount: approvedMembersCount,
        emergencyFund: t.emergencyFund
          ? {
              id: t.emergencyFund.id,
              name: t.emergencyFund.name,
              description: t.emergencyFund.description,
              minimumAmount: Number(t.emergencyFund.minimumAmount),
              frequency: t.emergencyFund.frequency,
              rules: t.emergencyFund.rules,
              isActive: t.emergencyFund.isActive,
              totalCollected: t.emergencyFund.contributions
                .filter((c) => c.status === "COMPLETED")
                .reduce((s, c) => s + Number(c.amount), 0),
              totalExpected: Number(t.emergencyFund.minimumAmount) * approvedMembersCount,
              contributions: t.emergencyFund.contributions.map((c) => ({
                id: c.id,
                userId: c.userId,
                userName: c.user.name,
                amount: Number(c.amount),
                paymentMethod: c.paymentMethod,
                status: c.status,
                createdAt: c.createdAt.toISOString(),
              })),
            }
          : null,
        memberships: t.memberships.map((m) => ({
          id: m.id,
          userId: m.userId,
          userName: m.user.name,
          userPhone: m.user.phone,
          status: m.status,
          slotCount: m.slotCount,
          disclaimerAcceptedAt: m.disclaimerAcceptedAt?.toISOString() ?? null,
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
  const adminConfig = await getPrivateTontineConfig();

  // 1. Strictly enforce cycle-matching start date on backend!
  const cycleCheck = isStartDateValidForCycle(data.type, data.startDate);
  if (!cycleCheck.valid) {
    return NextResponse.json(
      { error: cycleCheck.errorMessage || `Date de démarrage incompatible avec le cycle choisi (${cycleCheck.expectedLabel}).` },
      { status: 400 },
    );
  }

  // 2. Enforce admin-configured min/max amounts & slots
  if (data.amount < adminConfig.minAmount || data.amount > adminConfig.maxAmount) {
    return NextResponse.json(
      {
        error: `La mise doit être comprise entre ${adminConfig.minAmount.toLocaleString("fr-FR")} FCFA et ${adminConfig.maxAmount.toLocaleString("fr-FR")} FCFA.`,
      },
      { status: 400 },
    );
  }
  if (
    data.maxSlots !== null &&
    data.maxSlots !== undefined &&
    (data.maxSlots < adminConfig.minSlots || data.maxSlots > adminConfig.maxSlotsLimit)
  ) {
    return NextResponse.json(
      {
        error: `Le nombre de places doit être compris entre ${adminConfig.minSlots} et ${adminConfig.maxSlotsLimit}.`,
      },
      { status: 400 },
    );
  }

  // 3. Enforce admin-enabled features strictly on backend (reject any disabled feature!)
  const enabledKeys = new Set(
    adminConfig.actions.filter((a) => a.enabledByAdmin).map((a) => a.key),
  );
  if (Array.isArray(data.selectedActions)) {
    const unauthorized = data.selectedActions.filter((k) => !enabledKeys.has(k));
    if (unauthorized.length > 0) {
      return NextResponse.json(
        {
          error: `Une ou plusieurs options sélectionnées sont désactivées par l'administrateur DIVA Asso (${unauthorized.join(", ")}).`,
        },
        { status: 403 },
      );
    }
  }
  if (data.emergencyFund?.enabled && !enabledKeys.has("allow_emergency_fund")) {
    return NextResponse.json(
      { error: "La caisse de secours est actuellement désactivée par l'administrateur DIVA Asso." },
      { status: 403 },
    );
  }

  const chosenActions = Array.isArray(data.selectedActions)
    ? data.selectedActions
    : adminConfig.actions
        .filter((a) => a.enabledByAdmin && a.defaultSelected)
        .map((a) => a.key);

  const finesEnabled = chosenActions.includes("allow_fines");
  const startDate = new Date(`${data.startDate.slice(0, 10)}T12:00:00.000Z`);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, isBanned: true },
  });
  if (!user || user.isBanned) {
    return NextResponse.json({ error: "Compte non autorisé" }, { status: 403 });
  }

  const payoutPct = enabledKeys.has("allow_custom_payout_split")
    ? data.privateAdditionalFeePayoutPct
    : 100;
  const penaltyPct = enabledKeys.has("allow_custom_penalty_split")
    ? data.privatePenaltyBeneficiaryPct
    : 100;

  // Verify designated guarantor
  const guarantorMembership = await prisma.membership.findFirst({
    where: {
      userId: data.guarantorId,
      status: "APPROVED",
      tontineSession: { isPrivate: false, status: { not: "CLOSED" } },
    },
    include: {
      user: { select: { id: true, name: true, phone: true, email: true, preferredLang: true } },
      tontineSession: { select: { id: true, title: true, type: true } },
    },
  });

  if (!guarantorMembership || !guarantorMembership.user) {
    return NextResponse.json(
      { error: "Le garant sélectionné doit impérativement être un membre actif et validé dans au moins une cotisation publique." },
      { status: 400 },
    );
  }
  const guarantorUser = guarantorMembership.user;

  // Create in PENDING_ADMIN with NO inviteToken yet — Admin must inspect and approve before invite link is activated!
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
        fineAmountPerPeriod: finesEnabled ? (data.fineAmountPerPeriod ?? 500) : 0,
        fineIntervalHours: data.fineIntervalHours ?? 24,
        isPrivate: true,
        inviteToken: null,
        creatorId: userId,
        creatorParticipates: data.creatorParticipates,
        privateMinParticipants: adminConfig.minSlots,
        privateAdditionalFeePayoutPct: payoutPct,
        privatePenaltyBeneficiaryPct: penaltyPct,
        privateApprovalStatus: "PENDING_ADMIN",
        privateRulesAcceptedAt: new Date(),
        privateConfig: {
          selectedActions: chosenActions,
          creatorFullName: data.creatorFullName,
          creatorPhotoUrl: data.creatorPhotoUrl,
          creatorIdDocUrl: data.creatorIdDocUrl,
          guarantorId: data.guarantorId,
          guarantorName: guarantorUser.name,
          guarantorPhone: guarantorUser.phone,
          guarantorPublicSession: guarantorMembership.tontineSession.title || guarantorMembership.tontineSession.type,
          guarantorStatus: "PENDING",
          guarantorRequestedAt: new Date().toISOString(),
        },
      },
    });

    // Creator participates ONLY if they explicitly chose "Gestionnaire et membre participant"
    if (data.creatorParticipates) {
      const membership = await tx.membership.create({
        data: {
          userId,
          tontineSessionId: tontine.id,
          status: "APPROVED",
          slotCount: 1,
          disclaimerAcceptedAt: new Date(),
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
    }

    // Optional Emergency Fund (Secours) — ONLY created if creator explicitly activated it!
    if (data.emergencyFund?.enabled && data.emergencyFund.minimumAmount) {
      await tx.privateEmergencyFund.create({
        data: {
          tontineSessionId: tontine.id,
          name: data.emergencyFund.name || `Caisse de secours — ${data.title}`,
          minimumAmount: data.emergencyFund.minimumAmount,
          frequency: data.emergencyFund.frequency || null,
          description: data.emergencyFund.description || null,
          rules: data.emergencyFund.rules || null,
          isActive: true,
        },
      });
    }

    return tontine;
  });

  // 1. Notify Designated Guarantor
  const gLang = guarantorUser.preferredLang === "en" ? "en" : "fr";
  const guarantorMsg =
    gLang === "fr"
      ? `${data.creatorFullName} souhaite créer la cotisation privée « ${created.title} » et vous a désigné(e) comme garant. En tant que membre d'une cotisation publique DIVA Asso, acceptez-vous de vous porter garant en cas de défaillance ?`
      : `${data.creatorFullName} wishes to create the private tontine "${created.title}" and designated you as guarantor. Do you accept to guarantee this cotisation?`;

  await scheduleInAppNotifications({
    tontineSessionId: created.id,
    type: "ADMIN_BROADCAST",
    recipients: [
      {
        userId: guarantorUser.id,
        message: guarantorMsg,
        actionUrl: "/private-tontines",
      },
    ],
  }).catch(() => {});

  if (guarantorUser.email) {
    const gTitle =
      gLang === "fr"
        ? "Demande de cautionnement — Cotisation privée DIVA Asso"
        : "Guarantee Request — DIVA Asso";
    const gHtml = renderBrandedEmailHtml({
      title: gTitle,
      bodyText: guarantorMsg,
      actionUrl: "/private-tontines",
      actionLabel: gLang === "fr" ? "Répondre à la demande" : "Respond to request",
      recipientName: guarantorUser.name,
      lang: gLang,
    });
    await sendEmailSafe(guarantorUser.email, gTitle, gHtml).catch(() => {});
  }

  // 2. Notify all Admins to inspect & approve (noting guarantor pending)
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
        message: `Nouvelle cotisation privée à valider : « ${created.title} » créée par ${user.name} (${Number(created.amount).toLocaleString("fr-FR")} FCFA · Min ${adminConfig.minSlots} participants).`,
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
    metadata: {
      title: created.title,
      amount: Number(created.amount),
      fee: Number(created.fee),
      creatorParticipates: data.creatorParticipates,
      privateMinParticipants: adminConfig.minSlots,
      privateAdditionalFeePayoutPct: payoutPct,
      privatePenaltyBeneficiaryPct: penaltyPct,
      hasEmergencyFund: Boolean(data.emergencyFund?.enabled),
    },
    request,
  });

  return NextResponse.json(
    {
      ok: true,
      id: created.id,
      privateApprovalStatus: "PENDING_ADMIN",
      message:
        "Votre cotisation privée a été soumise à l'administrateur DIVA Asso pour validation. Votre lien d'invitation sera généré dès son approbation.",
    },
    { status: 201 },
  );
}
