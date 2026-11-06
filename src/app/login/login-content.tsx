"use client";

import { useEffect, useState } from "react";
import { CredentialsForm } from "./credentials-form";
import { LanguageToggle } from "@/components/language-toggle";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { translate, type Lang, type TranslationKey } from "@/lib/i18n/translations";

interface DevUser {
  email: string;
  name: string;
  role: string;
  signInAction: () => Promise<void>;
}

function oauthErrorKey(code: string): TranslationKey {
  switch (code) {
    case "AccountBanned":
      return "accountBannedError";
    case "AccessDenied":
      return "oauthErrorAccessDenied";
    case "Configuration":
      return "oauthErrorConfiguration";
    default:
      return "oauthErrorDefault";
  }
}

function OAuthErrorBanner({ error, lang }: { error?: string; lang: Lang }) {
  if (!error || error === "CredentialsSignin") return null;

  return (
    <div
      role="alert"
      className="relative z-10 mb-stack-gap-md rounded-lg bg-error-container text-on-error-container px-4 py-3 font-label-sm text-label-sm text-center"
    >
      {translate(lang, oauthErrorKey(error))}
    </div>
  );
}

export function LoginContent({
  callbackUrl,
  devUsers,
  isDev,
  oauthError,
  sessionExpired,
  lang,
  initialMode,
}: {
  callbackUrl: string;
  devUsers: DevUser[];
  isDev: boolean;
  oauthError?: string;
  sessionExpired?: boolean;
  lang: Lang;
  initialMode?: "signin" | "signup";
}) {
  const t = (key: TranslationKey) => translate(lang, key);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [localOAuthError, setLocalOAuthError] = useState<string | undefined>(oauthError);

  // Safety net: if an OAuth hash lands directly on /login, forward it to /auth/callback
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash.includes("access_token=")) {
      const nextParam = encodeURIComponent(callbackUrl || "/dashboard");
      window.location.replace(`/auth/callback?next=${nextParam}${window.location.hash}`);
    }
  }, [callbackUrl]);

  async function handleGoogleClick(e: React.MouseEvent) {
    e.preventDefault();
    setGoogleLoading(true);
    setLocalOAuthError(undefined);

    try {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        setLocalOAuthError("Configuration");
        setGoogleLoading(false);
        return;
      }

      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(
        callbackUrl || "/dashboard",
      )}`;

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
          queryParams: {
            prompt: "select_account",
          },
        },
      });

      if (error) {
        console.error("[LoginContent] Google signInWithOAuth error:", error.message);
        setLocalOAuthError("Default");
        setGoogleLoading(false);
      }
    } catch (err) {
      console.error("[LoginContent] unexpected Google sign-in error:", err);
      setLocalOAuthError("Default");
      setGoogleLoading(false);
    }
  }

  return (
    <main className="flex-grow flex flex-col items-center justify-center p-container-padding bg-background min-h-screen">
      <LanguageToggle currentLang={lang} className="mb-stack-gap-md relative z-10" />

      <div className="w-full max-w-[440px] glass-card rounded-[24px] p-stack-gap-lg sm:p-section-margin relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-secondary-container rounded-full blur-[80px] opacity-20 -mr-10 -mt-10" />
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-primary-container rounded-full blur-[80px] opacity-10 -ml-10 -mb-10" />

        <div className="flex flex-col items-center mb-stack-gap-lg relative z-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-512.png" alt="DIVA Asso." className="w-24 h-24 rounded-2xl shadow-md" />
        </div>

        <div className="text-center mb-section-margin relative z-10">
          <h1 className="font-headline-lg-mobile text-headline-lg-mobile md:font-headline-lg md:text-headline-lg text-on-surface mb-stack-gap-sm">
            {t("welcome")}
          </h1>
          <p className="font-body-md text-body-md text-on-surface-variant">{t("subtitle")}</p>
        </div>

        <OAuthErrorBanner error={localOAuthError ?? oauthError} lang={lang} />

        {sessionExpired && (
          <div
            role="alert"
            className="relative z-10 mb-stack-gap-md rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-900 px-4 py-3 font-label-sm text-label-sm text-center flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px] text-amber-700">schedule</span>
            <span>{t("sessionExpiredNotice")}</span>
          </div>
        )}

        <CredentialsForm callbackUrl={callbackUrl} lang={lang} initialMode={initialMode} />

        <div className="relative z-10 flex items-center py-stack-gap-sm mt-stack-gap-lg">
          <div className="flex-grow border-t border-outline-variant" />
          <span className="flex-shrink-0 mx-4 font-label-sm text-label-sm text-outline">
            {t("orContinueWith")}
          </span>
          <div className="flex-grow border-t border-outline-variant" />
        </div>

        <form onSubmit={(e) => e.preventDefault()} className="relative z-10">
          <button
            type="button"
            onClick={handleGoogleClick}
            disabled={googleLoading}
            className="w-full flex items-center justify-center gap-stack-gap-sm bg-white border border-outline-variant rounded-lg py-3 px-4 hover:bg-surface-container-low transition-colors active:scale-[0.98] disabled:opacity-60 cursor-pointer"
          >
            {googleLoading ? (
              <span className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            ) : (
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
            )}
            <span className="font-label-md text-label-md text-on-surface">
              {googleLoading ? t("pleaseWait") : t("continueWithGoogle")}
            </span>
          </button>
        </form>
      </div>

      {isDev && (
        <div className="w-full max-w-[440px] mt-stack-gap-lg bg-white/90 rounded-2xl p-stack-gap-md border border-dashed border-outline-variant">
          <p className="font-label-sm text-label-sm text-on-surface-variant mb-stack-gap-sm text-center">
            {t("devOnly")}
          </p>
          {devUsers.length === 0 ? (
            <p className="font-label-sm text-label-sm text-error text-center">{t("noUsers")}</p>
          ) : (
            <div className="flex flex-col gap-stack-gap-sm">
              {devUsers.map((u) => (
                <form key={u.email} action={u.signInAction}>
                  <button
                    type="submit"
                    className="w-full flex items-center justify-between gap-2 border border-outline-variant rounded-lg py-2 px-3 hover:bg-surface-container-low transition-colors text-left"
                  >
                    <span className="font-label-md text-label-md text-on-surface">{u.name}</span>
                    <span className="font-label-sm text-label-sm text-on-surface-variant">{u.role}</span>
                  </button>
                </form>
              ))}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
