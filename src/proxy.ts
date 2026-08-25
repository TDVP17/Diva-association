import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ADMIN_PATH_PREFIX, PROTECTED_PATH_PREFIXES } from "@/lib/constants";

function matchesPrefix(pathname: string, prefixes: readonly string[]) {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export default auth((req) => {
  const { nextUrl } = req;
  const path = nextUrl.pathname;
  const session = req.auth;

  if (session?.user && path === "/login") {
    return NextResponse.redirect(new URL("/dashboard", nextUrl));
  }

  if (!matchesPrefix(path, PROTECTED_PATH_PREFIXES)) {
    return NextResponse.next();
  }

  if (!session?.user) {
    const loginUrl = new URL("/login", nextUrl);
    loginUrl.searchParams.set("callbackUrl", path);
    return NextResponse.redirect(loginUrl);
  }

  if (path.startsWith(ADMIN_PATH_PREFIX) && session.user.role !== "ADMIN") {
    return NextResponse.redirect(new URL("/dashboard", nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"],
};
