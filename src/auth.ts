import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { SPONSOR_CODE_COOKIE } from "@/lib/constants";
import { getSupabaseAuthClient } from "@/lib/supabase-auth";

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
// `users` table so the resulting session carries role/kycStatus/sponsorCode
// exactly like every other provider. Sign-*up* is handled separately (see
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

    const { data, error } = await getSupabaseAuthClient().auth.signInWithPassword({
      email,
      password,
    });
    if (error || !data.user) return null;

    return prisma.user.findUnique({ where: { email } });
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
    Google,
    emailPasswordProvider,
    ...(process.env.NODE_ENV !== "production" ? [devLoginProvider] : []),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  events: {
    async createUser({ user }) {
      // First-time OAuth sign-up: attach the sponsor code the user entered
      // on the login screen before starting the OAuth flow (see login page),
      // carried through via a short-lived cookie since OAuth providers don't
      // let us pass arbitrary form fields through the redirect flow.
      if (!user.id) return;
      const cookieStore = await cookies();
      const sponsorCode = cookieStore.get(SPONSOR_CODE_COOKIE)?.value;
      if (sponsorCode) {
        await prisma.user.update({
          where: { id: user.id },
          data: { sponsorCode },
        });
      }
    },
  },
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user?.id) {
        token.id = user.id;
        token.role = user.role;
        token.kycStatus = user.kycStatus;
        token.sponsorCode = user.sponsorCode;
      }

      if (trigger === "update" && token.id) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id },
          select: { role: true, kycStatus: true, sponsorCode: true },
        });
        if (dbUser) {
          token.role = dbUser.role;
          token.kycStatus = dbUser.kycStatus;
          token.sponsorCode = dbUser.sponsorCode;
        }
      }

      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      session.user.kycStatus = token.kycStatus;
      session.user.sponsorCode = token.sponsorCode;
      return session;
    },
  },
});
