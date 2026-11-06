import { cookies } from "next/headers";

export const SB_ACCESS_COOKIE = "sb-access-token";
export const SB_REFRESH_COOKIE = "sb-refresh-token";

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/**
 * Writes the Supabase Auth `access_token` and `refresh_token` cookies from a
 * Server Action or Route Handler (`httpOnly: false` so `@supabase/supabase-js`
 * in the browser and Server Components share the exact same tokens without
 * burning Vercel CPU on middleware refreshes).
 */
export async function setServerSupabaseCookies(accessToken: string, refreshToken: string) {
  const cookieStore = await cookies();
  const isProd = process.env.NODE_ENV === "production";

  cookieStore.set(SB_ACCESS_COOKIE, accessToken, {
    httpOnly: false,
    sameSite: "lax",
    secure: isProd,
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  });

  cookieStore.set(SB_REFRESH_COOKIE, refreshToken, {
    httpOnly: false,
    sameSite: "lax",
    secure: isProd,
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  });
}

/**
 * Clears Supabase Auth cookies AND any legacy NextAuth session cookies so a
 * sign-out cleanly logs out both new and transitional sessions.
 */
export async function clearServerAuthCookies() {
  const cookieStore = await cookies();
  const namesToClear = [
    SB_ACCESS_COOKIE,
    SB_REFRESH_COOKIE,
    "authjs.session-token",
    "__Secure-authjs.session-token",
    "next-auth.session-token",
    "__Secure-next-auth.session-token",
  ];
  for (const name of namesToClear) {
    try {
      cookieStore.delete(name);
    } catch {
      // Ignore if cookie not present or called outside mutable context
    }
  }
}

