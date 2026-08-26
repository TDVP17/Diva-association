import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { logAudit } from "@/lib/audit";

const bodySchema = z.object({ paused: z.boolean() });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { id } = await params;
  await prisma.tontineSession.update({ where: { id }, data: { isPaused: parsed.data.paused } });
  await logAudit({
    actorId: admin.user.id,
    action: parsed.data.paused ? "contribution_paused" : "contribution_resumed",
    targetType: "TontineSession",
    targetId: id,
    tontineSessionId: id,
  });
  return NextResponse.json({ ok: true });
}
