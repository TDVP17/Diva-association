import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(5000).optional(),
  amount: z.coerce.number().positive().optional(),
  fee: z.coerce.number().nonnegative().optional(),
  fineAmountPerPeriod: z.coerce.number().nonnegative().optional(),
  fineIntervalHours: z.coerce.number().int().positive().optional(),
  rules: z.string().trim().max(5000).optional(),
  startDate: z.coerce.date().optional(),
  limitTime: z.string().trim().min(1).max(100).optional(),
  maxSlots: z.coerce.number().positive().nullable().optional(),
  drawDate: z.coerce.date().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { id } = await params;
  try {
    await prisma.tontineSession.update({ where: { id }, data: parsed.data });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/sessions PATCH] unexpected error:", err);
    return NextResponse.json({ error: "Could not update the cotisation. Please try again." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const [contributionCount, fineCount, payoutCount] = await Promise.all([
    prisma.contribution.count({ where: { membershipSlot: { membership: { tontineSessionId: id } } } }),
    prisma.fine.count({ where: { membershipSlot: { membership: { tontineSessionId: id } } } }),
    prisma.payout.count({ where: { tontineSessionId: id } }),
  ]);
  if (contributionCount > 0 || fineCount > 0 || payoutCount > 0) {
    return NextResponse.json(
      { error: "This cotisation has payment history — use Lock instead of Delete." },
      { status: 409 },
    );
  }

  try {
    await prisma.tontineSession.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/sessions DELETE] unexpected error:", err);
    return NextResponse.json({ error: "Could not delete the cotisation. Please try again." }, { status: 500 });
  }
}
