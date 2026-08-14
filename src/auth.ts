import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Apple from "next-auth/providers/apple";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { SPONSOR_CODE_COOKIE } from "@/lib/constants";

export const {
  handlers,
  auth,
  signIn,
  signOut,
  unstable_update: updateSession,
} = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [Google, Apple],
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
