import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { getBulkPaymentQuote } from "@/lib/initiate-bulk-payment";

const bodySchema = z.object({
  membershipSlotIds: z.array(z.string().min(1)).min(1),
});

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
    const result = await getBulkPaymentQuote(session.user.id, parsed.data.membershipSlotIds);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.quote);
  } catch (err) {
    console.error("[payments/bulk/quote] unexpected error:", err);
    return NextResponse.json({ error: "Could not calculate payment total" }, { status: 500 });
  }
}
