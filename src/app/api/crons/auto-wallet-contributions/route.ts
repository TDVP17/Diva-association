import { NextResponse } from "next/server";
import {
  isSaturdayEightAmCameroon,
  runAutoWalletContributionsSweep,
} from "@/lib/auto-wallet-contribution";

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

  if (!force && !isSaturdayEightAmCameroon()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "Le prélèvement automatique du portefeuille s'exécute le Samedi à partir de 08h00 (heure du Cameroun).",
    });
  }

  const result = await runAutoWalletContributionsSweep({ force });
  return NextResponse.json({ ok: true, ...result });
}

export async function POST(request: Request) {
  return GET(request);
}

