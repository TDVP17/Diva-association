import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { isDrawUnlocked } from "@/lib/tontine-engine";

const bodySchema = z.object({ order: z.array(z.string().min(1)).min(1) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { id } = await params;
  const tontineSession = await prisma.tontineSession.findUnique({
    where: { id },
    include: { memberships: { select: { slots: { select: { id: true } } } } },
  });
  if (!tontineSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (!isDrawUnlocked(tontineSession.startDate)) {
    return NextResponse.json(
      { error: "The draw unlocks 24 hours before the cotisation's start date" },
      { status: 403 },
    );
  }

  const existingIds = new Set(tontineSession.memberships.flatMap((m) => m.slots.map((s) => s.id)));
  const submittedIds = parsed.data.order;
  const sameSet =
    submittedIds.length === existingIds.size && submittedIds.every((sid) => existingIds.has(sid));
  if (!sameSet) {
    return NextResponse.json(
      { error: "The submitted order must include every slot exactly once" },
      { status: 400 },
    );
  }

  await prisma.$transaction([
    ...submittedIds.map((slotId, index) =>
      prisma.membershipSlot.update({
        where: { id: slotId },
        data: { officialPosition: index + 1 },
      }),
    ),
    ...(tontineSession.status === "DRAWING"
      ? [prisma.tontineSession.update({ where: { id }, data: { status: "ACTIVE" } })]
      : []),
  ]);

  return NextResponse.json({ ok: true });
}
