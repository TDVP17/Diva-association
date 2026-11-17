import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const withdrawals = await prisma.walletWithdrawal.findMany({
    include: {
      user: { select: { id: true, name: true, email: true, phone: true, memberCode: true } },
      approvedByAdmin: { select: { id: true, name: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 100,
  });

  const pendingCount = withdrawals.filter((w) => w.status === "PENDING_ADMIN").length;

  return NextResponse.json({
    pendingCount,
    withdrawals: withdrawals.map((w) => ({
      id: w.id,
      amount: Number(w.amount),
      phone: w.phone,
      provider: w.provider,
      accountName: w.accountName,
      status: w.status,
      requiresAdminApproval: w.requiresAdminApproval,
      fapshiTransId: w.fapshiTransId,
      rejectionReason: w.rejectionReason,
      approvedAt: w.approvedAt?.toISOString() ?? null,
      approvedByName: w.approvedByAdmin?.name ?? null,
      createdAt: w.createdAt.toISOString(),
      user: w.user,
    })),
  });
}

