import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getLang } from "@/lib/i18n/get-lang";
import { LoginContent } from "./login-content";
import { isAdminRole } from "@/lib/constants";

const isDev = process.env.NODE_ENV !== "production";

function isRedirectSignal(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    typeof (err as { digest?: unknown }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

async function signInWithGoogle(callbackUrl: string) {
  "use server";
  try {
    await signIn("google", { redirectTo: callbackUrl });
  } catch (err) {
    if (isRedirectSignal(err)) throw err;
    if (err instanceof AuthError) {
      const { redirect } = await import("next/navigation");
      redirect(`/login?error=${err.type}`);
    }
    console.error("[signInWithGoogle] unexpected error:", err);
    const { redirect } = await import("next/navigation");
    redirect("/login?error=Default");
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const { callbackUrl = "/dashboard", error } = await searchParams;
  const signInWithGoogleAction = signInWithGoogle.bind(null, callbackUrl);
  const lang = await getLang();

  const seededUsers = isDev
    ? await prisma.user
        .findMany({
          select: { email: true, name: true, role: true },
          orderBy: { createdAt: "asc" },
          take: 10,
        })
        .catch(() => [])
    : [];

  // Bind each user's dev-login action fully server-side (zero remaining
  // args) so the client component never needs to re-bind a server action.
  const devUsers = seededUsers.map((u) => ({
    email: u.email,
    name: u.name,
    role: u.role,
    signInAction: async () => {
      "use server";
      const redirectTo = callbackUrl === "/dashboard" && isAdminRole(u.role) ? "/admin" : callbackUrl;
      await signIn("dev-login", { email: u.email, redirectTo });
    },
  }));

  return (
    <LoginContent
      callbackUrl={callbackUrl}
      signInWithGoogleAction={signInWithGoogleAction}
      devUsers={devUsers}
      isDev={isDev}
      oauthError={error}
      lang={lang}
    />
  );
}
