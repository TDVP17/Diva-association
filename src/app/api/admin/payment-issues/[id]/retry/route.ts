import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { triggerAutomatedRefund } from "@/lib/trigger-fapshi-refund";

/** Admin-triggered manual retry of an escalated/failed automated refund — resets the 3-attempt budget. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const attempt = await prisma.paymentAttempt.findUnique({ where: { id } });
  if (!attempt) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (attempt.status !== "REFUND_FAILED_MANUAL_REVIEW" && attempt.status !== "DUPLICATE_PAID") {
    return NextResponse.json({ error: "This payment isn't awaiting a refund" }, { status: 409 });
  }

  await prisma.paymentAttempt.update({
    where: { id },
    data: { status: "DUPLICATE_PAID", refundAttempts: 0, nextRefundAttemptAt: new Date(), lastRefundError: null },
  });
  await triggerAutomatedRefund(id);

  const updated = await prisma.paymentAttempt.findUnique({ where: { id } });
  return NextResponse.json({ ok: true, status: updated?.status });
}
