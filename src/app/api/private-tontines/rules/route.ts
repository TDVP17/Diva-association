import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import {
  PRIVATE_TONTINE_RULES_ID,
  getPrivateTontineRules,
} from "@/lib/private-tontine-rules";
import { logAudit } from "@/lib/audit";

const updateRulesSchema = z.object({
  content: z.string().trim().min(20, "Les règles doivent contenir au moins 20 caractères.").max(20000),
});

export async function GET() {
  const data = await getPrivateTontineRules();
  return NextResponse.json(data);
}

export async function PUT(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const parsed = updateRulesSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Contenu invalide." },
      { status: 400 },
    );
  }

  const saved = await prisma.associationRules.upsert({
    where: { id: PRIVATE_TONTINE_RULES_ID },
    create: {
      id: PRIVATE_TONTINE_RULES_ID,
      content: parsed.data.content,
      updatedByAdminId: admin.user.id,
    },
    update: {
      content: parsed.data.content,
      updatedByAdminId: admin.user.id,
    },
  });

  await logAudit({
    actorId: admin.user.id,
    actorRole: admin.user.role,
    action: "private_tontine_rules_updated",
    targetType: "AssociationRules",
    targetId: PRIVATE_TONTINE_RULES_ID,
    request,
  });

  return NextResponse.json({
    ok: true,
    content: saved.content,
    updatedAt: saved.updatedAt.toISOString(),
  });
}

