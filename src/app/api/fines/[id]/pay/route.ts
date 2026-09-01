import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { initiateFinePayment } from "@/lib/initiate-fine-payment";

const bodySchema = z.object({ phone: z.string().min(1) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { id } = await params;

  try {
    const result = await initiateFinePayment(id, parsed.data.phone, session.user.id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ transId: result.transId });
  } catch (err) {
    console.error("[fines/pay] unexpected error:", err);
    return NextResponse.json({ error: "Payment initiation failed" }, { status: 500 });
  }
}
