import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { initiateSlotPayment } from "@/lib/initiate-slot-payment";

const bodySchema = z.object({
  membershipSlotId: z.string().min(1),
  phone: z.string().min(1),
});

// Contributing for a relative strictly requires the user to have an account
// and be logged in, ensuring the payment is associated with the payer,
// receipts are saved, and the transaction is recorded in their personal history.
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { error: "Vous devez être connecté à votre compte pour contribuer pour un proche." },
      { status: 401 }
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const result = await initiateSlotPayment(parsed.data.membershipSlotId, parsed.data.phone, {
      paidByUserId: session.user.id,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ transId: result.transId, link: result.link });
  } catch (err) {
    console.error("[payments/public/pay-slot] unexpected error:", err);
    return NextResponse.json({ error: "Payment initiation failed" }, { status: 500 });
  }
}
