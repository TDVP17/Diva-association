import { NextResponse } from "next/server";
import { requirePresident } from "@/lib/require-admin";
import { getRevenueAnalytics } from "@/lib/analytics";

export async function GET() {
  const president = await requirePresident();
  if (!president) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const analytics = await getRevenueAnalytics();
  return NextResponse.json(analytics);
}
