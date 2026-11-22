import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { logAudit } from "@/lib/audit";

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

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id: sessionId } = await params;
  const { searchParams } = new URL(request.url);
  const fineId = searchParams.get("fineId");

  if (!fineId) {
    return NextResponse.json({ error: "Identifiant d'amende requis (fineId)" }, { status: 400 });
  }

  const fine = await prisma.fine.findUnique({
    where: { id: fineId },
    include: {
      membershipSlot: {
        include: { membership: true },
      },
    },
  });

  if (!fine || fine.membershipSlot.membership.tontineSessionId !== sessionId) {
    return NextResponse.json({ error: "Amende introuvable pour cette session" }, { status: 404 });
  }

  await prisma.fine.delete({
    where: { id: fineId },
  });

  await logAudit({
    actorId: admin.user.id,
    actorRole: admin.user.role,
    action: "admin_cancelled_fine",
    targetType: "Fine",
    targetId: fineId,
    tontineSessionId: sessionId,
    metadata: {
      amount: Number(fine.amount),
      membershipSlotId: fine.membershipSlotId,
      dueDate: fine.dueDate.toISOString(),
    },
    request,
  });

  return NextResponse.json({ ok: true, deleted: true });
}
