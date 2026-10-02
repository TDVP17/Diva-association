import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * MobileConfig profile downloads have been deprecated in favor of standard Safari
 * Home Screen shortcut addition which requires zero iPhone Settings configuration.
 */
export async function GET(req: NextRequest) {
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("host") || "diva-association.vercel.app";
  return NextResponse.redirect(`${proto}://${host}/dashboard`);
}
