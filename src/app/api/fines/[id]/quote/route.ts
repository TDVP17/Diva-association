import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getFinePaymentQuote } from "@/lib/initiate-fine-payment";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  try {
    const result = await getFinePaymentQuote(id, session.user.id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.quote);
  } catch (err) {
    console.error("[fines/quote] unexpected error:", err);
    return NextResponse.json({ error: "Could not calculate payment total" }, { status: 500 });
  }
}
