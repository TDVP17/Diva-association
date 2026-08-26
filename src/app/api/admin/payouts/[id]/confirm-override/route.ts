import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { logAudit } from "@/lib/audit";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const claim = await prisma.payout.findUnique({ where: { id } });
  if (!claim) {
    return NextResponse.json({ error: "Payout claim not found" }, { status: 404 });
  }
  if (claim.status !== "RELEASED") {
    return NextResponse.json({ error: "This payout hasn't been sent yet" }, { status: 409 });
  }

  await prisma.payout.update({
    where: { id },
    data: { status: "CONFIRMED", memberConfirmedAt: new Date(), confirmedByAdmin: true },
  });

  await logAudit({
    actorId: admin.user.id,
    action: "payout_confirmed_by_admin_override",
    targetType: "Payout",
    targetId: id,
    tontineSessionId: claim.tontineSessionId,
  });

  return NextResponse.json({ ok: true });
}
