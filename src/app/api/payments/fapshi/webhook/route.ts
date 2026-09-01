import { NextResponse } from "next/server";
import { processFapshiTransaction } from "@/lib/process-fapshi-transaction";

export async function POST(request: Request) {
  const secret = request.headers.get("x-wh-secret");
  if (!secret || secret !== process.env.FAPSHI_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const transId = payload?.transId;
  if (typeof transId !== "string" || !transId) {
    return NextResponse.json({ error: "Missing transId" }, { status: 400 });
  }

  try {
    const baseUrl = process.env.NEXTAUTH_URL ?? new URL(request.url).origin;
    const result = await processFapshiTransaction(transId, baseUrl);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[payments/fapshi/webhook] unexpected error:", err);
    return NextResponse.json({ error: "Could not process this transaction" }, { status: 500 });
  }
}
