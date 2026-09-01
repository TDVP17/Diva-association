import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";

/**
 * Flagged duplicate-payment / refund rows for the admin security & finance
 * dashboard — anything currently queued for automated refund, actively
 * refunding, or that failed 3 automated attempts and needs a human.
 */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const attempts = await prisma.paymentAttempt.findMany({
    where: { status: { in: ["DUPLICATE_PAID", "REFUND_INITIATED", "REFUND_FAILED_MANUAL_REVIEW", "REFUNDED"] } },
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: {
      contribution: { include: { membershipSlot: { select: { beneficiaryName: true } } } },
      fine: { include: { membershipSlot: { select: { beneficiaryName: true } } } },
    },
  });

  return NextResponse.json({
    issues: attempts.map((a) => ({
      id: a.id,
      transId: a.transId,
      slotName: a.contribution?.membershipSlot.beneficiaryName ?? a.fine?.membershipSlot.beneficiaryName ?? null,
      amount: Number(a.amount),
      payerPhone: a.payerPhone,
      status: a.status,
      refundReason: a.refundReason,
      refundAttempts: a.refundAttempts,
      lastRefundError: a.lastRefundError,
      refundedAt: a.refundedAt,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    })),
  });
}
