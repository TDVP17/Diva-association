import { NextResponse } from "next/server";

export async function GET() {
  const externalApkUrl = process.env.NEXT_PUBLIC_ANDROID_APK_URL;
  if (externalApkUrl && externalApkUrl.startsWith("http")) {
    return NextResponse.redirect(externalApkUrl, 302);
  }

  // Fallback: If no hosted APK binary is configured yet, guide the member to the install flow
  const appUrl = process.env.NEXTAUTH_URL ?? "https://diva-association.vercel.app";
  return NextResponse.redirect(new URL("/?pwa=install", appUrl), 302);
}
