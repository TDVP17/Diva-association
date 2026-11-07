import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { getLang, getTranslator } from "@/lib/i18n/get-lang";
import { LanguageToggle } from "@/components/language-toggle";
import { MemberCodePayFlow } from "@/components/member-code-pay-flow";
import { SupabaseSessionBootstrap } from "@/components/supabase-session-bootstrap";

/**
 * Entry point for relatives/friends contributing on a member's behalf.
 * Strictly requires the user to be signed in or registered on the site before
 * accessing or validating a relative's contribution.
 */
export default async function PublicPayPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  const session = await auth();
  const callback = code ? `/pay?code=${encodeURIComponent(code)}` : "/pay";

  if (!session?.user) {
    redirect(`/login?callbackUrl=${encodeURIComponent(callback)}&authRequired=1`);
  }

  const lang = await getLang();
  const t = getTranslator(lang);

  async function handleSwitchAccount() {
    "use server";
    await signOut({
      redirectTo: `/login?callbackUrl=${encodeURIComponent(callback)}&signedOut=1&authRequired=1`,
    });
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-container-padding bg-background">
      {session.user.email && (
        <SupabaseSessionBootstrap expectedEmail={session.user.email} />
      )}
      <div className="w-full max-w-sm sm:max-w-md">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="min-w-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs">
            <span className="material-symbols-outlined text-[15px] text-emerald-700 shrink-0">verified_user</span>
            <span className="truncate font-medium">
              {session.user.name || session.user.email}
            </span>
            <form action={handleSwitchAccount} className="inline shrink-0 ml-1">
              <button
                type="submit"
                className="underline font-semibold text-emerald-800 hover:text-emerald-950 cursor-pointer"
              >
                {lang === "fr" ? "Déconnexion" : "Sign out"}
              </button>
            </form>
          </div>
          <LanguageToggle currentLang={lang} />
        </div>
        <div className="text-center mb-stack-gap-lg">
          <span className="font-headline-lg text-headline-lg text-primary tracking-tight">DIVA Asso</span>
          <h1 className="font-title-md text-title-md text-on-surface mt-2">{t("contributeForMember")}</h1>
        </div>
        <MemberCodePayFlow
          lang={lang}
          initialCode={code}
          currentUser={{ id: session.user.id, name: session.user.name, email: session.user.email }}
        />
      </div>
    </main>
  );
}
