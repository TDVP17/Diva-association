import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { initiateSlotPayment } from "@/lib/initiate-slot-payment";
import { logAudit } from "@/lib/audit";

const bodySchema = z.object({ membershipSlotId: z.string().min(1) });

// Authenticated counterpart to the public /api/payments/public/pay-slot
// link-share flow — this one requires login (per spec: "a person must have
// an account before using this feature") and records paidByUserId so the
// payer/beneficiary distinction shows up in receipts/history.
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const origin = new URL(request.url).origin;
    const result = await initiateSlotPayment(parsed.data.membershipSlotId, origin, {
      paidByUserId: session.user.id,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    await logAudit({
      actorId: session.user.id,
      action: "relative_payment_initiated",
      targetType: "MembershipSlot",
      targetId: parsed.data.membershipSlotId,
    });

    return NextResponse.json({ paymentUrl: result.paymentUrl });
  } catch (err) {
    console.error("[payments/relative/initiate] unexpected error:", err);
    return NextResponse.json({ error: "Payment initiation failed" }, { status: 500 });
  }
}
