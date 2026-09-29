"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { translate, type Lang, type TranslationKey } from "@/lib/i18n/translations";

export const COOKIE_CONSENT_KEY = "diva_cookie_consent";

export interface CookiePreferences {
  necessary: boolean;
  preferences: boolean;
  analytics: boolean;
  updatedAt: string;
}

const DEFAULT_PREFERENCES: CookiePreferences = {
  necessary: true,
  preferences: true,
  analytics: false,
  updatedAt: new Date().toISOString(),
};

export function openCookiePreferencesModal() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("diva:open-cookie-settings"));
  }
}

declare global {
  interface Window {
    openCookiePreferences?: () => void;
  }
}

export function CookieConsent({ lang }: { lang: Lang }) {
  const t = (key: TranslationKey, vars?: Record<string, string>) => translate(lang, key, vars);

  const [mounted, setMounted] = useState(false);
  const [showBanner, setShowBanner] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [preferences, setPreferences] = useState<CookiePreferences>(DEFAULT_PREFERENCES);

  // Read saved consent on mount
  useEffect(() => {
    setMounted(true);
    if (typeof window === "undefined") return;

    window.openCookiePreferences = openCookiePreferencesModal;

    const handleOpen = () => setShowModal(true);
    window.addEventListener("diva:open-cookie-settings", handleOpen);

    try {
      const stored = localStorage.getItem(COOKIE_CONSENT_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as CookiePreferences;
        setPreferences({
          necessary: true,
          preferences: Boolean(parsed.preferences),
          analytics: Boolean(parsed.analytics),
          updatedAt: parsed.updatedAt || new Date().toISOString(),
        });
        setShowBanner(false);
      } else {
        // Delay slight appearance for smooth entrance animation
        const timer = setTimeout(() => setShowBanner(true), 600);
        return () => {
          clearTimeout(timer);
          window.removeEventListener("diva:open-cookie-settings", handleOpen);
        };
      }
    } catch {
      setShowBanner(true);
    }

    return () => {
      window.removeEventListener("diva:open-cookie-settings", handleOpen);
    };
  }, []);

  const saveConsent = useCallback((newPrefs: CookiePreferences) => {
    const finalPrefs: CookiePreferences = {
      necessary: true,
      preferences: Boolean(newPrefs.preferences),
      analytics: Boolean(newPrefs.analytics),
      updatedAt: new Date().toISOString(),
    };

    setPreferences(finalPrefs);
    setShowBanner(false);
    setShowModal(false);

    if (typeof window !== "undefined") {
      try {
        const val = JSON.stringify(finalPrefs);
        localStorage.setItem(COOKIE_CONSENT_KEY, val);
        // Also persist in document.cookie for 1 year
        const expires = new Date();
        expires.setFullYear(expires.getFullYear() + 1);
        document.cookie = `${COOKIE_CONSENT_KEY}=${encodeURIComponent(val)}; expires=${expires.toUTCString()}; path=/; SameSite=Lax`;
      } catch (e) {
        console.warn("[Cookies] Failed to save consent:", e);
      }
    }
  }, []);

  const handleAcceptAll = useCallback(() => {
    saveConsent({
      necessary: true,
      preferences: true,
      analytics: true,
      updatedAt: new Date().toISOString(),
    });
  }, [saveConsent]);

  const handleRejectNonEssential = useCallback(() => {
    saveConsent({
      necessary: true,
      preferences: false,
      analytics: false,
      updatedAt: new Date().toISOString(),
    });
  }, [saveConsent]);

  const handleSaveCustom = useCallback(() => {
    saveConsent(preferences);
  }, [saveConsent, preferences]);

  if (!mounted) return null;

  return (
    <>
      {/* Floating Cookie Consent Banner */}
      {showBanner && !showModal && (
        <aside
          aria-label={t("cookiesTitle")}
          role="region"
          className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:max-w-md z-50 bg-surface/95 backdrop-blur-md rounded-2xl p-5 shadow-[0px_20px_50px_rgba(0,53,40,0.22)] border border-primary/20 animate-in slide-in-from-bottom duration-300"
        >
          <div className="flex items-start gap-3.5 mb-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="material-symbols-outlined text-[22px]">cookie</span>
            </div>
            <div className="min-w-0">
              <h2 className="font-title-sm text-title-sm text-primary font-bold leading-tight">
                {t("cookiesTitle")}
              </h2>
              <p className="font-body-sm text-xs text-on-surface-variant mt-1 leading-relaxed">
                {t("cookiesBannerDesc")}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-primary font-medium mb-3.5 px-0.5">
            <span className="material-symbols-outlined text-[16px]">verified_user</span>
            <Link
              href="/cookies"
              className="underline hover:text-primary/80 transition-colors"
            >
              {t("cookiesPolicyLink")}
            </Link>
          </div>

          {/* Action buttons */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleAcceptAll}
                className="flex-1 py-2.5 px-3 rounded-xl bg-primary text-on-primary font-label-md text-xs font-bold hover:opacity-90 active:scale-95 transition-all text-center shadow-sm cursor-pointer"
              >
                {t("cookiesAcceptAll")}
              </button>
              <button
                type="button"
                onClick={handleRejectNonEssential}
                className="flex-1 py-2.5 px-3 rounded-xl bg-surface-variant/40 hover:bg-surface-variant/70 text-on-surface font-label-md text-xs font-semibold border border-outline-variant/40 active:scale-95 transition-all text-center cursor-pointer"
              >
                {t("cookiesRejectNonEssential")}
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowModal(true)}
              className="py-1 text-center font-label-sm text-xs text-on-surface-variant hover:text-primary transition-colors flex items-center justify-center gap-1 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">tune</span>
              <span>{t("cookiesCustomize")}</span>
            </button>
          </div>
        </aside>
      )}

      {/* Preferences Modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg bg-surface rounded-2xl shadow-2xl border border-surface-variant max-h-[90vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="p-5 border-b border-surface-variant flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                  <span className="material-symbols-outlined text-[20px]">cookie</span>
                </div>
                <div>
                  <h2 className="font-title-sm text-title-sm text-primary font-bold">
                    {t("cookiesModalTitle")}
                  </h2>
                  <p className="font-label-sm text-[11px] text-on-surface-variant">
                    DIVA Association
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                aria-label="Close"
                className="w-8 h-8 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-variant/50 transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto space-y-4">
              <p className="font-body-sm text-xs text-on-surface-variant leading-relaxed">
                {t("cookiesModalDesc")}
              </p>

              {/* Category 1: Strictly Necessary */}
              <div className="p-4 rounded-xl bg-surface-container-low border border-surface-variant flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary text-[20px]">lock</span>
                    <span className="font-label-md text-sm font-bold text-on-surface">
                      {t("cookiesCatNecessaryTitle")}
                    </span>
                  </div>
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-semibold">
                    <span className="material-symbols-outlined text-[13px]">check_circle</span>
                    {t("cookiesCatNecessaryBadge")}
                  </span>
                </div>
                <p className="font-body-sm text-xs text-on-surface-variant leading-relaxed">
                  {t("cookiesCatNecessaryDesc")}
                </p>
              </div>

              {/* Category 2: Preferences */}
              <div className="p-4 rounded-xl bg-surface-container-low border border-surface-variant flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary text-[20px]">palette</span>
                    <span className="font-label-md text-sm font-bold text-on-surface">
                      {t("cookiesCatPreferencesTitle")}
                    </span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={preferences.preferences}
                      onChange={(e) =>
                        setPreferences((prev) => ({ ...prev, preferences: e.target.checked }))
                      }
                    />
                    <div className="w-11 h-6 bg-slate-300 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                  </label>
                </div>
                <p className="font-body-sm text-xs text-on-surface-variant leading-relaxed">
                  {t("cookiesCatPreferencesDesc")}
                </p>
              </div>

              {/* Category 3: Analytics */}
              <div className="p-4 rounded-xl bg-surface-container-low border border-surface-variant flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary text-[20px]">insights</span>
                    <span className="font-label-md text-sm font-bold text-on-surface">
                      {t("cookiesCatAnalyticsTitle")}
                    </span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={preferences.analytics}
                      onChange={(e) =>
                        setPreferences((prev) => ({ ...prev, analytics: e.target.checked }))
                      }
                    />
                    <div className="w-11 h-6 bg-slate-300 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                  </label>
                </div>
                <p className="font-body-sm text-xs text-on-surface-variant leading-relaxed">
                  {t("cookiesCatAnalyticsDesc")}
                </p>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-surface-variant bg-surface flex items-center justify-between gap-2.5">
              <button
                type="button"
                onClick={handleAcceptAll}
                className="py-2.5 px-4 rounded-xl bg-surface-variant/50 hover:bg-surface-variant text-on-surface font-label-md text-xs font-semibold transition-all cursor-pointer"
              >
                {t("cookiesAcceptAll")}
              </button>
              <button
                type="button"
                onClick={handleSaveCustom}
                className="py-2.5 px-5 rounded-xl bg-primary text-on-primary font-label-md text-xs font-bold hover:opacity-90 active:scale-95 transition-all shadow-md cursor-pointer"
              >
                {t("cookiesSavePreferences")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function ManageCookiesButton({
  lang,
  className = "",
  children,
}: {
  lang: Lang;
  className?: string;
  children?: React.ReactNode;
}) {
  const t = (key: TranslationKey, vars?: Record<string, string>) => translate(lang, key, vars);

  return (
    <button
      type="button"
      onClick={openCookiePreferencesModal}
      className={
        className ||
        "font-label-sm text-xs text-on-surface-variant hover:text-primary transition-colors flex items-center gap-1 cursor-pointer"
      }
    >
      {children || (
        <>
          <span className="material-symbols-outlined text-[15px]">cookie</span>
          <span>{t("landingFooterCookies")}</span>
        </>
      )}
    </button>
  );
}
