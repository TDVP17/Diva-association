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
    return prisma.user.findUnique({ where: { email } });
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
    const email = typeof credentials?.email === "string" ? credentials.email : null;
    const password = typeof credentials?.password === "string" ? credentials.password : null;
    if (!email || !password) return null;

    try {
      const { data, error } = await getSupabaseAuthClient().auth.signInWithPassword({
        email,
        password,
      });
      if (error || !data.user) return null;

      return await prisma.user.findUnique({ where: { email } });
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
  // 90-day persistence per product requirement — a session only ends when
  // the user explicitly logs out, or after 90 days of inactivity.
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 90 },
  jwt: { maxAge: 60 * 60 * 24 * 90 },
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
    async jwt({ token, user, trigger }) {
      if (user?.id) {
        token.id = user.id;
        token.role = user.role;
      }

      if (trigger === "update" && token.id) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id },
          select: { role: true },
        });
        if (dbUser) {
          token.role = dbUser.role;
        }
      }

      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      return session;
    },
  },
});
