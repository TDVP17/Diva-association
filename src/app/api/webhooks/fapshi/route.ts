import { NextResponse } from "next/server";
import { settlePendingFapshiDeposit } from "@/lib/wallet-reconcile";

/**
 * Fapshi Webhook receiver.
 * Triggered automatically by Fapshi upon payment completion (SUCCESSFUL / FAILED / EXPIRED).
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

    const result = await settlePendingFapshiDeposit(transId);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error("[webhooks/fapshi POST] error:", err);
    return NextResponse.json({ error: "Internal webhook error" }, { status: 500 });
  }
}

