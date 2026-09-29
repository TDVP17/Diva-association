import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { getSupabaseAuthClient } from "@/lib/supabase-auth";
import { ensureMemberCode } from "@/lib/member-code";

// Local-only "log in as any seeded user" provider — lets you click through
// the app without setting up real Google OAuth credentials. Excluded from
// the providers list entirely outside development, so it can never be
// reached on a deployed/production build.
const devLoginProvider = Credentials({
  id: "dev-login",
  name: "Dev Login",
  credentials: { email: { label: "Email", type: "text" } },
  async authorize(credentials) {
    const email = typeof credentials?.email === "string" ? credentials.email : null;
    if (!email) return null;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.isBanned) return null;
    return user;
  },
});

// Email/password sign-in. Supabase Auth is the source of truth for
// credential storage/verification (its own `auth.users` table, never
// touched by Prisma); on success we look the matching row up in our own
// `users` table so the resulting session carries role exactly like every
// other provider. Sign-*up* is handled separately (see
// src/app/login/actions.ts) since creating an account is a different
// operation from verifying one — this provider only ever verifies.
const emailPasswordProvider = Credentials({
  id: "email-password",
  name: "Email and Password",
  credentials: {
    email: { label: "Email", type: "email" },
    password: { label: "Password", type: "password" },
  },
  async authorize(credentials) {
    const rawIdentifier = typeof credentials?.email === "string" ? credentials.email.trim() : null;
    const password = typeof credentials?.password === "string" ? credentials.password : null;
    if (!rawIdentifier || !password) return null;

    let targetEmail = rawIdentifier;
    if (!rawIdentifier.includes("@")) {
      const cleanDigits = rawIdentifier.replace(/\D/g, "");
      const user = await prisma.user.findFirst({
        where: {
          OR: [
            { phone: rawIdentifier },
            { phone: cleanDigits },
            ...(cleanDigits.startsWith("237") ? [{ phone: cleanDigits.slice(3) }] : []),
            ...(!cleanDigits.startsWith("237") && cleanDigits.length === 9 ? [{ phone: `237${cleanDigits}` }] : []),
          ],
        },
        select: { email: true },
      });
      if (!user?.email) return null;
      targetEmail = user.email;
    }

    try {
      const { data, error } = await getSupabaseAuthClient().auth.signInWithPassword({
        email: targetEmail,
        password,
      });
      if (error || !data.user) return null;

      const dbUser = await prisma.user.findUnique({ where: { email: targetEmail } });
      if (!dbUser || dbUser.isBanned) return null;
      return dbUser;
    } catch (err) {
      // Never let a network hiccup or unexpected Supabase/Prisma error
      // surface as an unhandled crash here — treat it as "not authorized"
      // and let the caller show a normal "try again" message instead.
      console.error("[email-password authorize] unexpected error:", err);
      return null;
    }
  },
});

export const {
  handlers,
  auth,
  signIn,
  signOut,
  unstable_update: updateSession,
} = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    // Google verifies email ownership itself, so it's safe to link a Google
    // sign-in to an existing `users` row with the same email even if that
    // row was created via the email/password flow (which never creates an
    // Account row). Without this, anyone who signed up with email/password
    // and later taps "Continue with Google" gets refused with
    // OAuthAccountNotLinked instead of just being logged in.
    Google({ allowDangerousEmailAccountLinking: true }),
    emailPasswordProvider,
    ...(process.env.NODE_ENV !== "production" ? [devLoginProvider] : []),
  ],
  // 90-day (~3 months) persistence: the user stays logged in while actively using
  // the app, but is automatically disconnected after more than 3 months of inactivity.
  session: {
    strategy: "jwt",
    maxAge: 90 * 24 * 60 * 60, // 90 days = 3 months
    updateAge: 24 * 60 * 60, // Updates sliding expiration at most once every 24h while active
  },
  jwt: {
    maxAge: 90 * 24 * 60 * 60,
  },
  cookies: {
    sessionToken: {
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
        maxAge: 90 * 24 * 60 * 60,
      },
    },
  },
  // Auto-detected on Vercel; explicit here so the Google OAuth callback
  // (which relies on Auth.js inferring the correct host from the request)
  // still works correctly behind a reverse proxy or on non-Vercel hosts.
  trustHost: true,
  pages: {
    signIn: "/login",
    error: "/login",
  },
  events: {
    // Fires once, only for a brand-new account created via the Prisma
    // adapter (i.e. a first-time Google sign-in) — the email/password
    // sign-up flow creates its User row directly and calls
    // ensureMemberCode() itself (see src/app/login/actions.ts).
    async createUser({ user }) {
      if (user.id) await ensureMemberCode(user.id);
    },
  },
  callbacks: {
    async signIn({ user }) {
      if (user?.email) {
        const dbUser = await prisma.user.findUnique({
          where: { email: user.email.toLowerCase() },
          select: { isBanned: true },
        });
        if (dbUser?.isBanned) {
          return "/login?error=AccountBanned";
        }
      }
      return true;
    },
    async jwt({ token, user, trigger }) {
      const now = Math.floor(Date.now() / 1000);
      const THREE_MONTHS_SECONDS = 90 * 24 * 60 * 60;

      if (user?.id) {
        token.id = user.id;
        token.role = user.role;
        token.lastConnectedAt = now;
      }

      // If more than 3 months elapsed since last connection/activity, expire session
      if (token.lastConnectedAt && typeof token.lastConnectedAt === "number") {
        if (now - token.lastConnectedAt > THREE_MONTHS_SECONDS) {
          return null;
        }
      }

      token.lastConnectedAt = now;

      // Invalidate session if user has been banned
      if (token.id) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { role: true, isBanned: true },
        });
        if (!dbUser || dbUser.isBanned) {
          return null;
        }
        if (trigger === "update" || !token.role) {
          token.role = dbUser.role;
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (!token || !token.id) {
        return null as unknown as typeof session;
      }
      session.user.id = token.id as string;
      session.user.role = token.role as any;
      return session;
    },
  },
});
