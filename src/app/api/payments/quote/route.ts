import { NextResponse } from "next/server";
import { z } from "zod";
import { getSlotPaymentQuote } from "@/lib/initiate-slot-payment";

const bodySchema = z.object({
  membershipSlotId: z.string().min(1),
});

// Deliberately no auth() call — mirrors /api/payments/public/pay-slot. This
// only previews what a payment will cost (never charges anything or
// exposes the gateway/president fee split), so it's safe for the
// unauthenticated public pay-slot flow to call too.
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const result = await getSlotPaymentQuote(parsed.data.membershipSlotId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.quote);
  } catch (err) {
    console.error("[payments/quote] unexpected error:", err);
    return NextResponse.json({ error: "Could not calculate payment total" }, { status: 500 });
  }
}
