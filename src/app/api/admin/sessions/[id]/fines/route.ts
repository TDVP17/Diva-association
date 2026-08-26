import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const fines = await prisma.fine.findMany({
    where: { membershipSlot: { membership: { tontineSessionId: id } } },
    include: {
      membershipSlot: { include: { membership: { include: { user: { select: { name: true } } } } } },
    },
    orderBy: { dueDate: "desc" },
  });

  return NextResponse.json({
    fines: fines.map((f) => ({
      id: f.id,
      beneficiaryName: f.membershipSlot.beneficiaryName,
      memberName: f.membershipSlot.membership.user.name,
      amount: Number(f.amount),
      status: f.status,
      dueDate: f.dueDate.toISOString(),
    })),
  });
}
