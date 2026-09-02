import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { initiateBulkPayment } from "@/lib/initiate-bulk-payment";

const bodySchema = z.object({
  membershipSlotIds: z.array(z.string().min(1)).min(1),
  phone: z.string().min(1),
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
    const result = await initiateBulkPayment(session.user.id, parsed.data.membershipSlotIds, parsed.data.phone);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ transId: result.transId });
  } catch (err) {
    console.error("[payments/bulk/initiate] unexpected error:", err);
    return NextResponse.json({ error: "Payment initiation failed" }, { status: 500 });
  }
}
