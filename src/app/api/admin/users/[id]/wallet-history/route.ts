import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { getUserWalletData } from "@/lib/wallet";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  try {
    const data = await getUserWalletData(id, { includeAllForAdmin: true });
    return NextResponse.json(data);
  } catch (err) {
    console.error("[api/admin/users/[id]/wallet-history GET] error:", err);
    return NextResponse.json({ error: "Failed to fetch user history" }, { status: 500 });
  }
}

