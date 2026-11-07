import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import NextAuth, { type Session } from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { getSupabaseAuthClient } from "@/lib/supabase-auth";
import {
  SB_ACCESS_COOKIE,
  SB_REFRESH_COOKIE,
  clearServerAuthCookies,
} from "@/lib/supabase/auth-cookies";

// ---------------------------------------------------------------------------
// Legacy NextAuth fallback — strictly read-only (no `/api/auth/*` route is
// exposed anymore). Only decodes a pre-migration NextAuth JWT cookie so those
// members are NOT disconnected; `<SupabaseSessionBootstrap />` silently
// upgrades them to a native Supabase Auth Bearer session on their next visit.
// ---------------------------------------------------------------------------
const legacyNextAuth = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    Google({ allowDangerousEmailAccountLinking: true }),
    Credentials({
      id: "email-password",
      credentials: { email: {}, password: {} },
      async authorize() {
        return null;
      },
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 365 * 24 * 60 * 60,
  },
  trustHost: true,
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) {
        token.id = user.id;
        token.role = user.role;
      }
      if (token.id) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { role: true, isBanned: true },
        });
        if (!dbUser || dbUser.isBanned) return null;
        token.role = dbUser.role;
      }
      return token;
    },
    async session({ session, token }) {
      if (!token?.id) return null as unknown as typeof session;
      session.user.id = token.id as string;
      session.user.role = token.role;
      return session;
    },
  },
});

function isNextControlFlowError(err: unknown): boolean {
  if (typeof err !== "object" || err === null || !("digest" in err)) return false;
  const digest = (err as { digest?: unknown }).digest;
  return (
    typeof digest === "string" &&
    (digest === "DYNAMIC_SERVER_USAGE" ||
      digest.startsWith("NEXT_REDIRECT") ||
      digest.startsWith("NEXT_HTTP_ERROR_FALLBACK"))
  );
}

/**
 * Primary server session resolver powered by **Supabase Auth** (`sb-access-token`
 * / `sb-refresh-token` cookies), cached per React request render pass.
 *
 * Falls back transparently to any pre-existing NextAuth cookie so zero active
 * members are logged out during migration.
 */
export const auth = cache(async (): Promise<Session | null> => {
  try {
    const cookieStore = await cookies();
    const accessToken = cookieStore.get(SB_ACCESS_COOKIE)?.value;
    const refreshToken = cookieStore.get(SB_REFRESH_COOKIE)?.value;

    if (accessToken || refreshToken) {
      const supabase = getSupabaseAuthClient();
      let supaUser = null;
      let expiresIso = new Date(Date.now() + 3600 * 1000).toISOString();

      if (accessToken) {
        const { data, error } = await supabase.auth.getUser(accessToken);
        if (!error && data?.user) {
          supaUser = data.user;
        }
      }

      if (!supaUser && refreshToken) {
        const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession({
          refresh_token: refreshToken,
        });
        if (!refreshErr && refreshed?.user) {
          supaUser = refreshed.user;
          if (refreshed.session?.expires_at) {
            expiresIso = new Date(refreshed.session.expires_at * 1000).toISOString();
          }
        }
      }

      if (supaUser) {
        const emailLower = supaUser.email?.trim().toLowerCase();
        const dbUser = await prisma.user.findFirst({
          where: {
            OR: [
              { authUserId: supaUser.id },
              ...(emailLower ? [{ email: { equals: emailLower, mode: "insensitive" as const } }] : []),
            ],
          },
          select: {
            id: true,
            email: true,
            name: true,
            avatar: true,
            image: true,
            role: true,
            isBanned: true,
            authUserId: true,
          },
        });

        if (!dbUser || dbUser.isBanned) {
          return null;
        }

        if (!dbUser.authUserId) {
          void prisma.user
            .update({ where: { id: dbUser.id }, data: { authUserId: supaUser.id } })
            .catch(() => {});
        }

        return {
          user: {
            id: dbUser.id,
            email: dbUser.email,
            name: dbUser.name,
            image: dbUser.avatar ?? dbUser.image ?? null,
            role: dbUser.role,
          },
          expires: expiresIso,
        };
      }
    }
  } catch (err) {
    if (isNextControlFlowError(err)) throw err;
    console.error("[supabase auth()] error:", err);
  }

  // Fallback for members still carrying an active NextAuth cookie prior to silent upgrade
  try {
    return await legacyNextAuth.auth();
  } catch (err) {
    if (isNextControlFlowError(err)) throw err;
    return null;
  }
});

/**
 * Signs the user out by clearing all Supabase Auth + legacy NextAuth cookies
 * and redirecting to `options.redirectTo` (defaults to `/login`).
 */
export async function signOut(options?: { redirectTo?: string }) {
  await clearServerAuthCookies();
  if (options?.redirectTo) {
    let target = options.redirectTo;
    if (target.startsWith("/login") && !target.includes("signedOut=")) {
      target += target.includes("?") ? "&signedOut=1" : "?signedOut=1";
    }
    redirect(target);
  }
}
