import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { initiateFinePayment } from "@/lib/initiate-fine-payment";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const origin = new URL(request.url).origin;

  try {
    const result = await initiateFinePayment(id, session.user.id, origin);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ paymentUrl: result.paymentUrl });
  } catch (err) {
    console.error("[fines/pay] unexpected error:", err);
    return NextResponse.json({ error: "Payment initiation failed" }, { status: 500 });
  }
}
