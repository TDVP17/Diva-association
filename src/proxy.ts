import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ADMIN_PATH_PREFIX, PROTECTED_PATH_PREFIXES, isAdminRole } from "@/lib/constants";

function matchesPrefix(pathname: string, prefixes: readonly string[]) {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export default auth((req) => {
  const { nextUrl } = req;
  const path = nextUrl.pathname;
  const session = req.auth;

  // Role-aware, mirroring signInAction's post-login redirect (src/app/login/actions.ts)
  // — an admin who lands back on /login with a still-valid session must not
  // bounce through /dashboard first. Sending them there only for
  // (app)/layout.tsx to immediately redirect again to /admin produced an
  // extra hop that looked like a retry loop for admin accounts specifically.
  if (session?.user && path === "/login") {
    const target = isAdminRole(session.user.role) ? "/admin" : "/dashboard";
    return NextResponse.redirect(new URL(target, nextUrl));
  }

  if (!matchesPrefix(path, PROTECTED_PATH_PREFIXES)) {
    return NextResponse.next();
  }

  if (!session?.user) {
    const loginUrl = new URL("/login", nextUrl);
    loginUrl.searchParams.set("callbackUrl", path);
    return NextResponse.redirect(loginUrl);
  }

  if (path.startsWith(ADMIN_PATH_PREFIX) && !isAdminRole(session.user.role)) {
    return NextResponse.redirect(new URL("/dashboard", nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"],
};
