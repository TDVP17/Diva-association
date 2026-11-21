import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/require-admin";
import {
  getGlobalWithdrawalLimits,
  setGlobalWithdrawalLimits,
} from "@/lib/withdrawal-limits";
import { logAudit } from "@/lib/audit";

const updateSchema = z
  .object({
    minWithdrawalAmount: z.number().int().min(100, "Minimum retrait : 100 FCFA").max(10_000_000),
    maxWithdrawalAmount: z.number().int().min(500, "Maximum retrait : au moins 500 FCFA").max(50_000_000),
    withdrawalApprovalThreshold: z.number().int().min(1_000, "Seuil minimum : 1 000 FCFA").max(50_000_000).default(50_000),
    minTopupAmount: z.number().int().min(100, "Minimum recharge : 100 FCFA").max(10_000_000).default(500),
    maxTopupAmount: z.number().int().min(500, "Maximum recharge : au moins 500 FCFA").max(50_000_000).default(500_000),
  })
  .refine((d) => d.maxWithdrawalAmount >= d.minWithdrawalAmount, {
    message: "Le montant maximum de retrait doit être supérieur ou égal au montant minimum.",
  })
  .refine((d) => d.maxTopupAmount >= d.minTopupAmount, {
    message: "Le montant maximum de recharge doit être supérieur ou égal au montant minimum de recharge.",
  });

export async function GET() {
  const limits = await getGlobalWithdrawalLimits();
  return NextResponse.json(limits);
}

export async function PUT(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Montants invalides." },
      { status: 400 },
    );
  }

  const before = await getGlobalWithdrawalLimits();
  const saved = await setGlobalWithdrawalLimits(
    parsed.data.minWithdrawalAmount,
    parsed.data.maxWithdrawalAmount,
    parsed.data.withdrawalApprovalThreshold,
    parsed.data.minTopupAmount,
    parsed.data.maxTopupAmount,
  );

  await logAudit({
    actorId: admin.user.id,
    actorRole: admin.user.role,
    action: "global_withdrawal_limits_updated",
    targetType: "AppSetting",
    targetId: "singleton",
    payloadBefore: before as unknown as Record<string, unknown>,
    payloadAfter: saved as unknown as Record<string, unknown>,
    request,
  });

  return NextResponse.json({ ok: true, ...saved });
}

