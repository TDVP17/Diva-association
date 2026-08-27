import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { getTontineConfig, computeFeeSplitAmounts } from "@/lib/tontine-engine";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const tontineSession = await prisma.tontineSession.findUnique({ where: { id } });
  if (!tontineSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const [feesCollected, unpaidFines] = await Promise.all([
    prisma.contribution.aggregate({
      where: { membershipSlot: { membership: { tontineSessionId: id } }, status: "PAID" },
      _sum: { feePaid: true },
    }),
    prisma.fine.aggregate({
      where: { membershipSlot: { membership: { tontineSessionId: id } }, status: "UNPAID" },
      _sum: { amount: true },
    }),
  ]);

  const totalFees = Number(feesCollected._sum.feePaid ?? 0);
  const totalUnpaidFines = Number(unpaidFines._sum.amount ?? 0);
  const config = getTontineConfig(tontineSession.type);

  const feeSplit = config.feeSplit ? computeFeeSplitAmounts(totalFees, config.feeSplit) : null;

  return NextResponse.json({ totalFees, totalUnpaidFines, feeSplit });
}
