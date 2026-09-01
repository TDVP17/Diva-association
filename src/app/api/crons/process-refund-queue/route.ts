import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { triggerAutomatedRefund } from "@/lib/trigger-fapshi-refund";

/**
 * Durable backstop for the automated duplicate-payment refund system — the
 * immediate inline attempt in process-fapshi-transaction.ts handles the
 * common case, this cron retries anything that failed (network error,
 * Fapshi timeout, payout service briefly unconfigured) with the
 * exponential backoff already recorded on nextRefundAttemptAt, up to 3
 * total attempts before escalating to REFUND_FAILED_MANUAL_REVIEW.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const due = await prisma.paymentAttempt.findMany({
    where: {
      status: "DUPLICATE_PAID",
      OR: [{ nextRefundAttemptAt: null }, { nextRefundAttemptAt: { lte: new Date() } }],
    },
    select: { id: true },
    take: 50,
  });

  let processed = 0;
  for (const row of due) {
    await triggerAutomatedRefund(row.id);
    processed++;
  }

  return NextResponse.json({ ok: true, processed, checkedAt: new Date().toISOString() });
}
