import { NextResponse } from "next/server";
import { processFapshiTransaction } from "@/lib/process-fapshi-transaction";

/**
 * Polled by the payment-confirm dialog while the payer is completing the
 * USSD prompt on their phone — a backup to the webhook (push, primary) for
 * when it's slow to arrive or the merchant's webhook secret isn't
 * configured yet. Settlement itself is idempotent (see
 * processFapshiTransaction), so whichever path — webhook or this poll —
 * gets there first is the one that actually credits the payment.
 *
 * Deliberately no auth() call, same reasoning as the public pay-slot route:
 * transId is an opaque, unguessable Fapshi-generated string, and this only
 * ever returns a bare status, never amounts/names/phone numbers.
 */
export async function GET(request: Request) {
  const transId = new URL(request.url).searchParams.get("transId")?.trim();
  if (!transId) {
    return NextResponse.json({ error: "Missing transId" }, { status: 400 });
  }

  try {
    const baseUrl = process.env.NEXTAUTH_URL ?? new URL(request.url).origin;
    const result = await processFapshiTransaction(transId, baseUrl);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[payments/fapshi/status] unexpected error:", err);
    return NextResponse.json({ error: "Could not check payment status" }, { status: 500 });
  }
}
