import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/require-admin";
import {
  getPrivateTontineConfig,
  setPrivateTontineConfig,
} from "@/lib/private-tontine-config";
import { logAudit } from "@/lib/audit";

const actionSchema = z.object({
  key: z.string().trim().min(2).max(60),
  label: z.string().trim().min(2).max(120),
  description: z.string().trim().max(300).default(""),
  enabledByAdmin: z.boolean(),
  defaultSelected: z.boolean().default(false),
});

const configSchema = z
  .object({
    minSlots: z.number().int().min(2).max(500),
    maxSlotsLimit: z.number().int().min(2).max(1000),
    minAmount: z.number().int().min(500).max(50_000_000),
    maxAmount: z.number().int().min(1000).max(100_000_000),
    actions: z.array(actionSchema).min(1).max(30),
  })
  .refine((d) => d.maxSlotsLimit >= d.minSlots, {
    message: "Le nombre maximum de places doit être >= au nombre minimum.",
  })
  .refine((d) => d.maxAmount >= d.minAmount, {
    message: "La mise maximale doit être >= à la mise minimale.",
  });

export async function GET() {
  const config = await getPrivateTontineConfig();
  return NextResponse.json(config);
}

export async function PUT(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const parsed = configSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Configuration invalide." },
      { status: 400 },
    );
  }

  const saved = await setPrivateTontineConfig(parsed.data, admin.user.id);

  await logAudit({
    actorId: admin.user.id,
    actorRole: admin.user.role,
    action: "private_tontine_config_updated",
    targetType: "AssociationRules",
    targetId: "private_tontine_config",
    metadata: {
      minSlots: saved.minSlots,
      maxSlotsLimit: saved.maxSlotsLimit,
      actionsCount: saved.actions.length,
    },
    request,
  });

  return NextResponse.json({ ok: true, config: saved });
}

