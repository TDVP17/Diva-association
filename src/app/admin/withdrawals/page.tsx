import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { AdminWithdrawalsClient, type AdminWithdrawalRow } from "./admin-withdrawals-client";

export default async function AdminWithdrawalsPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/dashboard");

  const withdrawals = await prisma.walletWithdrawal.findMany({
    include: {
      user: { select: { id: true, name: true, email: true, phone: true, memberCode: true } },
      approvedByAdmin: { select: { id: true, name: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 100,
  });

  const initialWithdrawals: AdminWithdrawalRow[] = withdrawals.map((w) => ({
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
  }));

  return <AdminWithdrawalsClient initialWithdrawals={initialWithdrawals} />;
}

