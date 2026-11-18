import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import {
  calculatePrivatePlatformFee,
  calculateAdditionalFeeSplit,
} from "@/lib/private-tontine-finance";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const tontines = await prisma.tontineSession.findMany({
    where: { isPrivate: true, softDeletedAt: null },
    include: {
      creator: { select: { id: true, name: true, email: true, phone: true, memberCode: true } },
      emergencyFund: {
        include: {
          contributions: { select: { amount: true, status: true } },
        },
      },
      memberships: {
        include: {
          user: { select: { id: true, name: true, email: true, phone: true } },
        },
        orderBy: { joinedAt: "asc" },
      },
    },
    orderBy: [{ privateApprovalStatus: "desc" }, { startDate: "desc" }],
    take: 100,
  });

  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://divaasso.com").replace(
    /^https?:\/\/www\.divaasso\.com/i,
    "https://divaasso.com",
  );

  return NextResponse.json({
    pendingCount: tontines.filter((t) => t.privateApprovalStatus === "PENDING_ADMIN").length,
    tontines: tontines.map((t) => {
      const approvedMembers = t.memberships.filter((m) => m.status === "APPROVED");
      const cyclesEstimate = Math.max(
        approvedMembers.length,
        t.maxSlots ? Number(t.maxSlots) : (t.privateMinParticipants ?? 2),
      );
      const platformFee = calculatePrivatePlatformFee(Number(t.amount), cyclesEstimate);
      const additionalSplit = calculateAdditionalFeeSplit(
        Number(t.fee),
        t.privateAdditionalFeePayoutPct ?? 100,
      );
      return {
        id: t.id,
        title: t.title || "Cotisation Privée",
        description: t.description,
        type: t.type,
        amount: Number(t.amount),
        fee: Number(t.fee),
        fineAmountPerPeriod: t.fineAmountPerPeriod ? Number(t.fineAmountPerPeriod) : 0,
        status: t.status,
        startDate: t.startDate.toISOString(),
        limitTime: t.limitTime,
        maxSlots: t.maxSlots ? Number(t.maxSlots) : null,
        creatorParticipates: t.creatorParticipates,
        privateMinParticipants: t.privateMinParticipants ?? 2,
        privateAdditionalFeePayoutPct: t.privateAdditionalFeePayoutPct ?? 100,
        privatePenaltyBeneficiaryPct: t.privatePenaltyBeneficiaryPct ?? 100,
        platformFee,
        additionalSplit,
        privateApprovalStatus: t.privateApprovalStatus,
        privateRejectionReason: t.privateRejectionReason,
        privateRulesAcceptedAt: t.privateRulesAcceptedAt?.toISOString() ?? null,
        inviteUrl: t.inviteToken ? `${baseUrl}/join/${t.inviteToken}` : null,
        approvedMembersCount: approvedMembers.length,
        memberships: t.memberships.map((m) => ({
          id: m.id,
          userId: m.userId,
          userName: m.user.name,
          userEmail: m.user.email,
          status: m.status,
          disclaimerAcceptedAt: m.disclaimerAcceptedAt?.toISOString() ?? null,
        })),
        emergencyFund: t.emergencyFund
          ? {
              name: t.emergencyFund.name,
              minimumAmount: Number(t.emergencyFund.minimumAmount),
              totalCollected: t.emergencyFund.contributions
                .filter((c) => c.status === "COMPLETED")
                .reduce((s, c) => s + Number(c.amount), 0),
            }
          : null,
        creator: t.creator,
      };
    }),
  });
}
