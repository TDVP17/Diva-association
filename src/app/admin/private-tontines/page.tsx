import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/constants";
import {
  AdminPrivateTontinesClient,
  type AdminPrivateTontineRow,
} from "./admin-private-tontines-client";

export default async function AdminPrivateTontinesPage() {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) redirect("/dashboard");

  const tontines = await prisma.tontineSession.findMany({
    where: { isPrivate: true, softDeletedAt: null },
    include: {
      creator: {
        select: { id: true, name: true, email: true, phone: true, memberCode: true },
      },
      emergencyFund: { select: { id: true, name: true, minimumAmount: true } },
      memberships: { select: { id: true, status: true } },
    },
    orderBy: [{ privateApprovalStatus: "desc" }, { startDate: "desc" }],
    take: 100,
  });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://divaasso.com";

  const rows: AdminPrivateTontineRow[] = tontines.map((t) => {
    const cfg = (t.privateConfig as Record<string, unknown> | null) ?? {};
    return {
      id: t.id,
      title: t.title || "Cotisation Privée",
      description: t.description,
      type: t.type,
      amount: Number(t.amount),
      fee: Number(t.fee),
      status: t.status,
      creatorParticipates: t.creatorParticipates ?? true,
      privateMinParticipants: t.privateMinParticipants ?? null,
      privateAdditionalFeePayoutPct: t.privateAdditionalFeePayoutPct ?? 100,
      privatePenaltyBeneficiaryPct: t.privatePenaltyBeneficiaryPct ?? 100,
      emergencyFundName: t.emergencyFund?.name ?? null,
      emergencyFundMinAmount: t.emergencyFund ? Number(t.emergencyFund.minimumAmount) : null,
      startDate: t.startDate.toISOString(),
      limitTime: t.limitTime,
      maxSlots: t.maxSlots ? Number(t.maxSlots) : null,
      privateApprovalStatus: t.privateApprovalStatus,
      privateRejectionReason: t.privateRejectionReason,
      privateRulesAcceptedAt: t.privateRulesAcceptedAt?.toISOString() ?? null,
      inviteUrl: t.inviteToken ? `${baseUrl}/join/${t.inviteToken}` : null,
      approvedMembersCount: t.memberships.filter((m) => m.status === "APPROVED").length,
      creator: t.creator,
      creatorFullName: (cfg.creatorFullName as string) || t.creator?.name || null,
      creatorPhotoUrl: (cfg.creatorPhotoUrl as string) || null,
      creatorIdDocUrl: (cfg.creatorIdDocUrl as string) || null,
      guarantorId: (cfg.guarantorId as string) || null,
      guarantorName: (cfg.guarantorName as string) || null,
      guarantorPhone: (cfg.guarantorPhone as string) || null,
      guarantorPublicSession: (cfg.guarantorPublicSession as string) || null,
      guarantorStatus: (cfg.guarantorStatus as string) || (cfg.guarantorId ? "PENDING" : null),
      guarantorRespondedAt: (cfg.guarantorRespondedAt as string) || null,
      guarantorDeclineReason: (cfg.guarantorDeclineReason as string) || null,
    };
  });

  return <AdminPrivateTontinesClient initialTontines={rows} />;
}
