import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

function sanitizeDestination(rawDest: string | null | undefined): string {
  if (!rawDest) return "/dashboard";
  const trimmed = rawDest.trim();
  // Must be a safe relative path starting with / and not // or /\
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.startsWith("/\\")) {
    return "/dashboard";
  }
  return trimmed;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawDest = searchParams.get("dest") || searchParams.get("target") || searchParams.get("url");
  const notificationId = searchParams.get("nid") || searchParams.get("notifId");
  const destination = sanitizeDestination(rawDest);

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    null;
  const userAgent = request.headers.get("user-agent") || null;

  // Resolve session (Supabase Auth / legacy JWT cookies)
  const session = await auth().catch(() => null);
  const userId = session?.user?.id || null;

  // Asynchronously record click event for deliverability & engagement analytics
  try {
    await prisma.notificationClick.create({
      data: {
        notificationId: notificationId || null,
        userId: userId || null,
        destination,
        ip,
        userAgent,
      },
    });
  } catch (err) {
    // Non-blocking: analytics error should never stop the user's redirect
    console.error("[smart-redirect /r] click tracking error:", err);
  }

  const appBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL ||
    new URL(request.url).origin;

  if (userId) {
    // Authenticated: redirect directly to the specific page
    return NextResponse.redirect(new URL(destination, appBaseUrl), 302);
  }

  // Unauthenticated: redirect to login while strictly preserving the deep-link callback
  const loginUrl = new URL("/login", appBaseUrl);
  loginUrl.searchParams.set("callbackUrl", destination);
  loginUrl.searchParams.set("authRequired", "1");
  return NextResponse.redirect(loginUrl, 302);
}

