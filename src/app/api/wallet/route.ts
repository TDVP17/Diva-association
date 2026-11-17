import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserWalletData } from "@/lib/wallet";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const data = await getUserWalletData(session.user.id);
    return NextResponse.json(data);
  } catch (err) {
    console.error("[api/wallet GET] error:", err);
    return NextResponse.json({ error: "Failed to fetch wallet" }, { status: 500 });
  }
}

