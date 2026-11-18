import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { logAudit } from "@/lib/audit";

const schema = z.object({
  /** Null resets to the global system withdrawal limit. */
  maxWithdrawalAmount: z.number().int().min(500).max(50_000_000).nullable(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Plafond de retrait invalide." }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, maxWithdrawalAmount: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Utilisateur introuvable." }, { status: 404 });
  }

  const updated = await prisma.user.update({
    where: { id },
    data: { maxWithdrawalAmount: parsed.data.maxWithdrawalAmount },
    select: { id: true, maxWithdrawalAmount: true },
  });

  await logAudit({
    actorId: admin.user.id,
    actorRole: admin.user.role,
    action: "user_withdrawal_limit_updated",
    targetType: "User",
    targetId: id,
    payloadBefore: { maxWithdrawalAmount: existing.maxWithdrawalAmount ? Number(existing.maxWithdrawalAmount) : null },
    payloadAfter: { maxWithdrawalAmount: updated.maxWithdrawalAmount ? Number(updated.maxWithdrawalAmount) : null },
    request,
  });

  return NextResponse.json({
    ok: true,
    maxWithdrawalAmount: updated.maxWithdrawalAmount ? Number(updated.maxWithdrawalAmount) : null,
  });
}

