import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { settlePendingFapshiDeposit } from "@/lib/wallet-reconcile";
import { processFapshiTransaction } from "@/lib/process-fapshi-transaction";

/**
 * Fapshi Webhook receiver.
 * Triggered automatically by Fapshi upon payment completion (SUCCESSFUL / FAILED / EXPIRED).
 * Handles wallet topups, contributions, bulk payments, fines, and loan repayments.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Empty payload" }, { status: 400 });
    }

    const transId = (body.transId || body.trans_id || body.externalId)?.toString()?.trim();
    if (!transId) {
      return NextResponse.json({ ok: false, error: "Missing transId" }, { status: 400 });
    }

    // 1. Check if it's a wallet transaction
    const walletTx = await prisma.walletTransaction.findFirst({
      where: { fapshiTxRef: transId },
      select: { id: true },
    });

    if (walletTx) {
      const result = await settlePendingFapshiDeposit(transId);
      return NextResponse.json({ ok: true, type: "wallet", result });
    }

    // 2. Otherwise process contribution, fine, or bulk payment
    const origin = process.env.NEXTAUTH_URL || "https://divaasso.com";
    const result = await processFapshiTransaction(transId, origin);
    return NextResponse.json({ ok: true, type: "transaction", result });
  } catch (err) {
    console.error("[webhooks/fapshi POST] error:", err);
    return NextResponse.json({ error: "Internal webhook error" }, { status: 500 });
  }
}
