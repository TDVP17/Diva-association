import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";

/** Irreversible — blocks new joins only, never payments already in progress. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  await prisma.tontineSession.update({ where: { id }, data: { lockedAt: new Date() } });
  return NextResponse.json({ ok: true });
}
