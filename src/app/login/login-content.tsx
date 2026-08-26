"use client";

import { CredentialsForm } from "./credentials-form";
import { LanguageToggle } from "@/components/language-toggle";
import { IosInstallBanner } from "@/components/ios-install-banner";
import { translate, type Lang, type TranslationKey } from "@/lib/i18n/translations";

interface DevUser {
  email: string;
  name: string;
  role: string;
  signInAction: () => Promise<void>;
}

// Maps a subset of Auth.js's error-page `error` query values to a
// translated, user-facing message. Anything not explicitly listed
// (including CredentialsSignin, which the credentials forms already
// surface inline) falls back to a generic message rather than showing
// nothing or leaking a raw error code.
function oauthErrorKey(code: string): TranslationKey {
  switch (code) {
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
  signInWithGoogleAction,
  devUsers,
  isDev,
  oauthError,
  lang,
}: {
  callbackUrl: string;
  signInWithGoogleAction: () => Promise<void>;
  devUsers: DevUser[];
  isDev: boolean;
  oauthError?: string;
  lang: Lang;
}) {
  const t = (key: TranslationKey) => translate(lang, key);

  return (
    <main className="flex-grow flex flex-col items-center justify-center p-container-padding bg-background min-h-screen">
      <LanguageToggle currentLang={lang} className="mb-stack-gap-md relative z-10" />

      <div className="w-full max-w-[440px] glass-card rounded-[24px] p-stack-gap-lg sm:p-section-margin relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-secondary-container rounded-full blur-[80px] opacity-20 -mr-10 -mt-10" />
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-primary-container rounded-full blur-[80px] opacity-10 -ml-10 -mb-10" />

        <div className="flex flex-col items-center gap-2 mb-stack-gap-lg relative z-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-512.png" alt="DIVA Associations" className="w-16 h-16 rounded-2xl shadow-sm" />
          <div className="font-headline-lg text-headline-lg text-primary tracking-tight">DIVA</div>
        </div>

        <div className="text-center mb-section-margin relative z-10">
          <h1 className="font-headline-lg-mobile text-headline-lg-mobile md:font-headline-lg md:text-headline-lg text-on-surface mb-stack-gap-sm">
            {t("welcome")}
          </h1>
          <p className="font-body-md text-body-md text-on-surface-variant">{t("subtitle")}</p>
        </div>

        <OAuthErrorBanner error={oauthError} lang={lang} />

        <CredentialsForm callbackUrl={callbackUrl} lang={lang} />

        <div className="relative z-10 flex items-center py-stack-gap-sm mt-stack-gap-lg">
          <div className="flex-grow border-t border-outline-variant" />
          <span className="flex-shrink-0 mx-4 font-label-sm text-label-sm text-outline">
            {t("orContinueWith")}
          </span>
          <div className="flex-grow border-t border-outline-variant" />
        </div>

        <form action={signInWithGoogleAction} className="relative z-10">
          <button
            type="submit"
            className="w-full flex items-center justify-center gap-stack-gap-sm bg-white border border-outline-variant rounded-lg py-3 px-4 hover:bg-surface-container-low transition-colors active:scale-[0.98]"
          >
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
            <span className="font-label-md text-label-md text-on-surface">
              {t("continueWithGoogle")}
            </span>
          </button>
        </form>

        <div className="mt-section-margin pt-stack-gap-md border-t border-outline-variant/30 flex items-center justify-center gap-unit text-center relative z-10">
          <span className="material-symbols-outlined text-secondary text-[16px]">lock</span>
          <p className="font-label-sm text-label-sm text-on-surface-variant flex items-center gap-1">
            {t("footer")}
          </p>
        </div>
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

      <IosInstallBanner lang={lang} />
    </main>
  );
}
