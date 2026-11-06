import { prisma } from "@/lib/prisma";
import { getLang } from "@/lib/i18n/get-lang";
import { LoginContent } from "./login-content";
import { devSignInSupabaseAction } from "./actions";

const isDev = process.env.NODE_ENV !== "production";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string; mode?: string; expired?: string }>;
}) {
  const { callbackUrl = "/dashboard", error, mode, expired } = await searchParams;
  const lang = await getLang();

  const seededUsers = isDev
    ? await prisma.user
        .findMany({
          where: { isBanned: false },
          select: { email: true, name: true, role: true },
          orderBy: { createdAt: "asc" },
          take: 10,
        })
        .catch(() => [])
    : [];

  const devUsers = seededUsers.map((u) => ({
    email: u.email,
    name: u.name,
    role: u.role,
    signInAction: async () => {
      "use server";
      await devSignInSupabaseAction(u.email, callbackUrl);
    },
  }));

  return (
    <LoginContent
      callbackUrl={callbackUrl}
      devUsers={devUsers}
      isDev={isDev}
      oauthError={error}
      sessionExpired={expired === "1"}
      lang={lang}
      initialMode={mode === "signup" ? "signup" : "signin"}
    />
  );
}
