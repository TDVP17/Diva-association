import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";

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
    include: { memberships: { select: { id: true } } },
  });
  if (!tontineSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const existingIds = new Set(tontineSession.memberships.map((m) => m.id));
  const submittedIds = parsed.data.order;
  const sameSet =
    submittedIds.length === existingIds.size && submittedIds.every((mid) => existingIds.has(mid));
  if (!sameSet) {
    return NextResponse.json(
      { error: "The submitted order must include every member exactly once" },
      { status: 400 },
    );
  }

  await prisma.$transaction([
    ...submittedIds.map((membershipId, index) =>
      prisma.membership.update({
        where: { id: membershipId },
        data: { officialPosition: index + 1 },
      }),
    ),
    ...(tontineSession.status === "DRAWING"
      ? [prisma.tontineSession.update({ where: { id }, data: { status: "ACTIVE" } })]
      : []),
  ]);

  return NextResponse.json({ ok: true });
}
