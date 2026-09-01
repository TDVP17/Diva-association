import { NextResponse } from "next/server";
import { z } from "zod";
import { initiateSlotPayment } from "@/lib/initiate-slot-payment";

const bodySchema = z.object({
  membershipSlotId: z.string().min(1),
  phone: z.string().min(1),
});

// Deliberately no auth() call — this is the public, no-login third-party
// contribution entry point. Anyone with the code can fund any slot that
// isn't already paid for the current cycle; no ownership check by design.
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const result = await initiateSlotPayment(parsed.data.membershipSlotId, parsed.data.phone);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ transId: result.transId });
  } catch (err) {
    console.error("[payments/public/pay-slot] unexpected error:", err);
    return NextResponse.json({ error: "Payment initiation failed" }, { status: 500 });
  }
}
