import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_PATH_PREFIX, PROTECTED_PATH_PREFIXES, isAdminRole } from "@/lib/constants";

const SB_ACCESS_COOKIE = "sb-access-token";
const SB_REFRESH_COOKIE = "sb-refresh-token";

function matchesPrefix(pathname: string, prefixes: readonly string[]) {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

interface DecodedSupabaseClaims {
  sub?: string;
  exp?: number;
  app_metadata?: {
    role?: string;
    is_banned?: boolean;
  };
}

/**
 * Lightweight local JWT payload inspection (0 network calls, 0 DB calls) for
 * fast route-level redirects in Next.js 16 `proxy.ts`. Full cryptographic
 * verification and DB `isBanned` checks happen in `auth()` inside layouts.
 */
function decodeJwtPayload(token: string): DecodedSupabaseClaims | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = atob(padded);
    return JSON.parse(json) as DecodedSupabaseClaims;
  } catch {
    return null;
  }
}

export default function proxy(req: NextRequest) {
  const { nextUrl, cookies } = req;
  const path = nextUrl.pathname;

  // Never intercept OAuth callback route
  if (path.startsWith("/auth/callback")) {
    return NextResponse.next();
  }

  const sbAccess = cookies.get(SB_ACCESS_COOKIE)?.value;
  const sbRefresh = cookies.get(SB_REFRESH_COOKIE)?.value;
  const hasLegacyCookie =
    cookies.has("authjs.session-token") ||
    cookies.has("__Secure-authjs.session-token") ||
    cookies.has("next-auth.session-token") ||
    cookies.has("__Secure-next-auth.session-token");

  const claims = sbAccess ? decodeJwtPayload(sbAccess) : null;
  const isBannedClaim = Boolean(claims?.app_metadata?.is_banned);
  const hasSupabaseSession = Boolean((claims?.sub && !isBannedClaim) || sbRefresh);
  const isAuthenticated = hasSupabaseSession || hasLegacyCookie;
  const role = claims?.app_metadata?.role ?? null;

  // Redirect already-signed-in Supabase users away from /login or / directly to their home area
  if (hasSupabaseSession && claims?.sub && (path === "/login" || path === "/")) {
    const nowSec = Math.floor(Date.now() / 1000);
    if (!claims.exp || claims.exp > nowSec) {
      const target = isAdminRole(role) ? "/admin" : "/dashboard";
      return NextResponse.redirect(new URL(target, nextUrl));
    }
  }

  // Marketing posters are strictly reserved for administrators
  if (path.startsWith("/posters")) {
    if (!isAuthenticated) {
      return NextResponse.redirect(new URL("/login", nextUrl));
    }
    if (claims?.sub && role && !isAdminRole(role)) {
      return NextResponse.redirect(new URL("/dashboard", nextUrl));
    }
  }

  if (!matchesPrefix(path, PROTECTED_PATH_PREFIXES)) {
    return NextResponse.next();
  }

  if (!isAuthenticated) {
    const loginUrl = new URL("/login", nextUrl);
    loginUrl.searchParams.set("callbackUrl", path);
    return NextResponse.redirect(loginUrl);
  }

  if (path.startsWith(ADMIN_PATH_PREFIX) && claims?.sub && role && !isAdminRole(role)) {
    return NextResponse.redirect(new URL("/dashboard", nextUrl));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"],
};
