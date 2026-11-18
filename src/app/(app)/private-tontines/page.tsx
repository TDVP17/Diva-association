import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getLang } from "@/lib/i18n/get-lang";
import { getPrivateTontineRules } from "@/lib/private-tontine-rules";
import { getPrivateTontineConfig } from "@/lib/private-tontine-config";
import { PrivateTontinesClient, type PrivateTontineItem } from "./private-tontines-client";

export default async function PrivateTontinesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=%2Fprivate-tontines");
  const userId = session.user.id;
  const lang = await getLang();

  const [tontines, privateRules, creationConfig] = await Promise.all([
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
            user: { select: { id: true, name: true, phone: true } },
            slots: { orderBy: { officialPosition: "asc" } },
          },
          orderBy: { joinedAt: "asc" },
        },
      },
      orderBy: { startDate: "desc" },
    }),
    getPrivateTontineRules(),
    getPrivateTontineConfig(),
  ]);

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://divaasso.com";

  const initialTontines: PrivateTontineItem[] = tontines.map((t) => {
    const isApprovedByAdmin = t.privateApprovalStatus === "APPROVED";
    return {
      id: t.id,
      title: t.title || "Cotisation Privée",
      description: t.description,
      type: t.type,
      amount: Number(t.amount),
      fee: Number(t.fee),
      status: t.status,
      isPaused: t.isPaused,
      isLocked: t.lockedAt !== null,
      privateApprovalStatus: t.privateApprovalStatus,
      privateRejectionReason: t.privateRejectionReason,
      creatorParticipates: t.creatorParticipates ?? true,
      privateMinParticipants: t.privateMinParticipants ?? null,
      privateAdditionalFeePayoutPct: t.privateAdditionalFeePayoutPct ?? 100,
      privatePenaltyBeneficiaryPct: t.privatePenaltyBeneficiaryPct ?? 100,
      parentSessionId: t.parentSessionId ?? null,
      privateConfig: (t.privateConfig as { selectedActions?: string[] } | null) ?? null,
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
      emergencyFund: t.emergencyFund
        ? {
            id: t.emergencyFund.id,
            name: t.emergencyFund.name,
            minimumAmount: Number(t.emergencyFund.minimumAmount),
            description: t.emergencyFund.description,
            rules: t.emergencyFund.rules,
            isActive: t.emergencyFund.isActive,
            contributions: t.emergencyFund.contributions.map((c) => ({
              id: c.id,
              amount: Number(c.amount),
              userId: c.userId,
              user: { name: c.user.name },
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
        joinedAt: m.joinedAt.toISOString(),
        slots: m.slots.map((s) => ({
          id: s.id,
          beneficiaryName: s.beneficiaryName,
          officialPosition: s.officialPosition,
          ballDrawn: s.ballDrawn,
        })),
      })),
    };
  });

  return (
    <PrivateTontinesClient
      lang={lang}
      initialTontines={initialTontines}
      privateRulesContent={privateRules.content}
      creationConfig={creationConfig}
      currentUserId={userId}
    />
  );
}
