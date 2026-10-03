import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  return NextResponse.json({ requests: [] });
}

