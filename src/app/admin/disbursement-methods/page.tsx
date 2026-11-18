import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { AdminDisbursementClient, type AdminDisbursementRow } from "./admin-disbursement-client";

export default async function AdminDisbursementMethodsPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/dashboard");

  const methods = await prisma.savedPaymentMethod.findMany({
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          memberCode: true,
        },
      },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });

  const initialMethods: AdminDisbursementRow[] = methods.map((m) => ({
    id: m.id,
    provider: m.provider,
    phone: m.phone,
    accountName: m.accountName,
    status: m.status,
    rejectionReason: m.rejectionReason,
    verifiedAt: m.verifiedAt?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
    user: m.user,
  }));

  return <AdminDisbursementClient initialMethods={initialMethods} />;
}
