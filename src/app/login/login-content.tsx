"use client";

import { useState, useRef } from "react";
import { CredentialsForm } from "./credentials-form";
import { LanguageToggle } from "@/components/language-toggle";
import { InstallPromptModal } from "@/components/install-prompt-modal";
import { translate, type Lang, type TranslationKey } from "@/lib/i18n/translations";
import { getGoogleSignInUrl } from "./actions";

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
  signInWithGoogleAction,
  devUsers,
  isDev,
  oauthError,
  sessionExpired,
  lang,
  initialMode,
}: {
  callbackUrl: string;
  signInWithGoogleAction: () => Promise<void>;
  devUsers: DevUser[];
  isDev: boolean;
  oauthError?: string;
  sessionExpired?: boolean;
  lang: Lang;
  initialMode?: "signin" | "signup";
}) {
  const t = (key: TranslationKey) => translate(lang, key);
  const [googleLoading, setGoogleLoading] = useState(false);
  const popupRef = useRef<Window | null>(null);

  async function handleGoogleClick(e: React.MouseEvent) {
    e.preventDefault();
    setGoogleLoading(true);

    try {
      const res = await getGoogleSignInUrl(callbackUrl);
      if (res.url) {
        const width = 500;
        const height = 650;
        const left = window.screenX + (window.outerWidth - width) / 2;
        const top = window.screenY + (window.outerHeight - height) / 2;
        const popup = window.open(
          res.url,
          "google_signin_popup",
          `width=${width},height=${height},left=${left},top=${top},status=no,menubar=no,toolbar=no`,
        );

        if (!popup || popup.closed || typeof popup.closed === "undefined") {
          // If popup is blocked by the browser, fallback to standard redirect
          window.location.href = res.url;
          return;
        }

        popupRef.current = popup;

        // Poll for popup closure or session establishment
        const interval = setInterval(async () => {
          if (!popupRef.current || popupRef.current.closed) {
            clearInterval(interval);
            try {
              const sessionRes = await fetch("/api/auth/session");
              const sessionData = await sessionRes.json();
              if (sessionData?.user) {
                window.location.href = callbackUrl;
                return;
              }
            } catch {}
            setGoogleLoading(false);
            return;
          }

          try {
            const sessionRes = await fetch("/api/auth/session");
            const sessionData = await sessionRes.json();
            if (sessionData?.user) {
              clearInterval(interval);
              try {
                popupRef.current?.close();
              } catch {}
              window.location.href = callbackUrl;
            }
          } catch {}
        }, 1200);
      } else {
        await signInWithGoogleAction();
      }
    } catch {
      await signInWithGoogleAction();
    }
  }

  function handleCancelGoogle() {
    if (popupRef.current && !popupRef.current.closed) {
      try {
        popupRef.current.close();
      } catch {}
    }
    popupRef.current = null;
    setGoogleLoading(false);
  }

  return (
    <main className="flex-grow flex flex-col items-center justify-center p-container-padding bg-background min-h-screen">
      <LanguageToggle currentLang={lang} className="mb-stack-gap-md relative z-10" />

      <div className="w-full max-w-[440px] glass-card rounded-[24px] p-stack-gap-lg sm:p-section-margin relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-secondary-container rounded-full blur-[80px] opacity-20 -mr-10 -mt-10" />
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-primary-container rounded-full blur-[80px] opacity-10 -ml-10 -mb-10" />

        <div className="flex flex-col items-center gap-2 mb-stack-gap-lg relative z-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-512.png" alt="" className="w-24 h-24 rounded-2xl shadow-md" />
          <div className="flex flex-col items-center leading-tight">
            <span className="font-headline-lg text-headline-lg text-primary tracking-tight">DIVA</span>
            <span className="font-title-md text-title-md text-secondary tracking-wide -mt-0.5">Asso</span>
          </div>
        </div>

        <div className="text-center mb-section-margin relative z-10">
          <h1 className="font-headline-lg-mobile text-headline-lg-mobile md:font-headline-lg md:text-headline-lg text-on-surface mb-stack-gap-sm">
            {t("welcome")}
          </h1>
          <p className="font-body-md text-body-md text-on-surface-variant">{t("subtitle")}</p>
        </div>

        <OAuthErrorBanner error={oauthError} lang={lang} />

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

        <form onSubmit={(e) => { e.preventDefault(); }} className="relative z-10">
          <button
            type="button"
            onClick={handleGoogleClick}
            disabled={googleLoading}
            className="w-full flex items-center justify-center gap-stack-gap-sm bg-white border border-outline-variant rounded-lg py-3 px-4 hover:bg-surface-container-low transition-colors active:scale-[0.98] disabled:opacity-60 cursor-pointer"
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

        {googleLoading && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-sm w-full text-center shadow-2xl border border-surface-variant flex flex-col items-center gap-4 animate-in fade-in zoom-in-95 duration-200">
              <div className="w-14 h-14 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                <span className="w-7 h-7 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              </div>
              <div>
                <h3 className="font-title-md text-title-md text-on-surface font-semibold">
                  {t("googleSignInInProgress")}
                </h3>
                <p className="font-body-sm text-body-sm text-on-surface-variant mt-2 leading-relaxed">
                  {t("googleSignInPopupNotice")}
                </p>
              </div>
              <button
                type="button"
                onClick={handleCancelGoogle}
                className="w-full mt-2 py-3 px-4 rounded-xl bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-label-md text-label-md transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm active:scale-98"
              >
                <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                {t("cancelAndReturn")}
              </button>
            </div>
          </div>
        )}
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

      <InstallPromptModal lang={lang} />
    </main>
  );
}
