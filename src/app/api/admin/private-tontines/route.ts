import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const tontines = await prisma.tontineSession.findMany({
    where: { isPrivate: true },
    include: {
      creator: { select: { id: true, name: true, email: true, phone: true, memberCode: true } },
      memberships: { select: { id: true, status: true } },
    },
    orderBy: [{ privateApprovalStatus: "desc" }, { startDate: "desc" }],
    take: 100,
  });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://divaasso.com";

  return NextResponse.json({
    pendingCount: tontines.filter((t) => t.privateApprovalStatus === "PENDING_ADMIN").length,
    tontines: tontines.map((t) => ({
      id: t.id,
      title: t.title || "Cotisation Privée",
      description: t.description,
      type: t.type,
      amount: Number(t.amount),
      fee: Number(t.fee),
      status: t.status,
      startDate: t.startDate.toISOString(),
      limitTime: t.limitTime,
      maxSlots: t.maxSlots ? Number(t.maxSlots) : null,
      privateApprovalStatus: t.privateApprovalStatus,
      privateRejectionReason: t.privateRejectionReason,
      privateRulesAcceptedAt: t.privateRulesAcceptedAt?.toISOString() ?? null,
      inviteUrl: t.inviteToken ? `${baseUrl}/join/${t.inviteToken}` : null,
      approvedMembersCount: t.memberships.filter((m) => m.status === "APPROVED").length,
      creator: t.creator,
    })),
  });
}
