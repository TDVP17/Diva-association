import { NextResponse } from "next/server";
import { runAutoWalletContributionsSweep } from "@/lib/auto-wallet-contribution";

function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = request.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "true";

  // Automatically sweeps every active session whose due date is tomorrow (J-1 >= 08:00 Cameroon time)
  const result = await runAutoWalletContributionsSweep({ force });
  return NextResponse.json({ ok: true, ...result });
}

export async function POST(request: Request) {
  return GET(request);
}
