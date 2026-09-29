"use client";

import { useEffect, useState, useRef } from "react";
import { translate, type Lang } from "@/lib/i18n/translations";

const DISMISSED_SESSION_KEY = "diva_pwa_dismissed_session";
const INSTALLED_KEY = "diva_pwa_installed";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isIosDevice(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isAndroidDevice(): boolean {
  if (typeof window === "undefined") return false;
  return /Android/i.test(window.navigator.userAgent);
}

function isInAppBrowser(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent || "";
  return /FBAN|FBAV|Instagram|WhatsApp|Line|Snapchat|Twitter|TikTok|MicroMessenger/i.test(ua);
}

function isStandaloneAlready(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true ||
    document.referrer.includes("android-app://") ||
    window.location.search.includes("mode=pwa")
  );
}

/**
 * Universal PWA Installation Component.
 * - When application is already installed on the user's device, it is impossible to download again.
 * - Checks standalone mode, localStorage flag, and getInstalledRelatedApps.
 * - On Android / Chromium: triggers native prompt in 1-click.
 * - On iOS Safari: presents an intuitive bottom sheet with an animated arrow pointing to Safari's Share button.
 */
export function InstallPromptModal({ lang }: { lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [inApp, setInApp] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // 1. Direct check: already installed or running as standalone PWA
    if (isStandaloneAlready() || localStorage.getItem(INSTALLED_KEY) === "1") {
      localStorage.setItem(INSTALLED_KEY, "1");
      setIsInstalled(true);
      return;
    }

    // 2. Browser getInstalledRelatedApps API check (Chromium Android & Desktop)
    if ("getInstalledRelatedApps" in navigator) {
      (navigator as Navigator & { getInstalledRelatedApps?: () => Promise<unknown[]> })
        .getInstalledRelatedApps?.()
        .then((apps) => {
          if (apps && apps.length > 0) {
            localStorage.setItem(INSTALLED_KEY, "1");
            setIsInstalled(true);
          }
        })
        .catch(() => {});
    }

    const ios = isIosDevice();
    const android = isAndroidDevice();
    const inAppBrowser = isInAppBrowser();

    setIsIos(ios);
    setIsAndroid(android);
    setInApp(inAppBrowser);

    if (sessionStorage.getItem(DISMISSED_SESSION_KEY)) {
      setDismissed(true);
    }

    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      const promptEvent = e as BeforeInstallPromptEvent;
      setDeferredPrompt(promptEvent);
      deferredPromptRef.current = promptEvent;
      // When browser fires this event, the app is confirmed NOT installed yet
      setReady(true);
    }

    function onAppInstalled() {
      localStorage.setItem(INSTALLED_KEY, "1");
      setIsInstalled(true);
      setDismissed(true);
      setDeferredPrompt(null);
      deferredPromptRef.current = null;
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);

    // On iOS Safari, beforeinstallprompt never fires; trigger prompt if not dismissed
    if (ios && !sessionStorage.getItem(DISMISSED_SESSION_KEY)) {
      const timer = setTimeout(() => {
        setReady(true);
      }, 1500);
      return () => {
        clearTimeout(timer);
        window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
        window.removeEventListener("appinstalled", onAppInstalled);
      };
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  // If already installed, never show anything (impossible to download again)
  if (isInstalled || (typeof window !== "undefined" && isStandaloneAlready())) {
    return null;
  }

  function handleDismiss() {
    if (typeof window !== "undefined") {
      sessionStorage.setItem(DISMISSED_SESSION_KEY, "1");
    }
    setDismissed(true);
  }

  function handleMarkAsAlreadyInstalled() {
    if (typeof window !== "undefined") {
      localStorage.setItem(INSTALLED_KEY, "1");
    }
    setIsInstalled(true);
    setDismissed(true);
  }

  async function handleInstallPwa() {
    const promptEvent = deferredPrompt || deferredPromptRef.current;
    if (promptEvent) {
      setInstalling(true);
      try {
        await promptEvent.prompt();
        const choice = await promptEvent.userChoice;
        if (choice.outcome === "accepted") {
          localStorage.setItem(INSTALLED_KEY, "1");
          setIsInstalled(true);
          setDismissed(true);
        }
      } catch (err) {
        console.error("[PWA] prompt error:", err);
      } finally {
        setInstalling(false);
      }
    }
  }

  const modalVisible = ready && !dismissed && !isInstalled;
  if (!modalVisible) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs animate-in fade-in duration-200 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl bg-surface p-5 sm:p-6 shadow-2xl relative border-t sm:border border-surface-variant max-h-[92vh] overflow-y-auto">
        {/* Close button */}
        <button
          onClick={handleDismiss}
          aria-label={t("close")}
          className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-variant/50 transition-colors"
        >
          <span className="material-symbols-outlined text-[20px]">close</span>
        </button>

        {/* App Icon + Title */}
        <div className="flex items-center gap-3.5 mb-4 text-left">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/icon-192.png"
            alt="DIVA Association"
            className="w-14 h-14 object-contain rounded-2xl shadow-md border border-slate-100 flex-shrink-0"
          />
          <div className="min-w-0">
            <h2 className="font-title-md text-title-md text-primary font-bold leading-tight">
              Diva Association
            </h2>
            <p className="font-label-sm text-xs text-on-surface-variant mt-0.5">
              {lang === "fr"
                ? "Application officielle"
                : "Official Mobile Application"}
            </p>
          </div>
        </div>

        {/* In-App Browser Warning (WhatsApp / Facebook) */}
        {inApp && (
          <div className="mb-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-on-surface leading-relaxed text-left flex gap-2">
            <span className="material-symbols-outlined text-amber-600 text-lg flex-shrink-0">
              info
            </span>
            <div>
              <strong className="block text-amber-800 font-semibold mb-0.5">
                {lang === "fr" ? "Ouvert dans WhatsApp" : "Opened in WhatsApp"}
              </strong>
              {lang === "fr" ? (
                isIos ? (
                  <>
                    Pour installer l&apos;application, touchez les <strong>⋯</strong> ou la boussole 🧭 en bas puis <strong>« Ouvrir dans Safari »</strong>.
                  </>
                ) : (
                  <>
                    Pour installer l&apos;application, touchez les <strong>⋮</strong> en haut à droite puis <strong>« Ouvrir dans Chrome »</strong>.
                  </>
                )
              ) : (
                <>
                  Please tap the menu and choose <strong>&quot;Open in {isIos ? "Safari" : "Chrome"}&quot;</strong> to install.
                </>
              )}
            </div>
          </div>
        )}

        {isIos ? (
          /* iOS Safari Installation: Visual guided bottom sheet */
          <div className="flex flex-col gap-3">
            <div className="p-3.5 rounded-2xl bg-surface-container-low border border-surface-variant text-left">
              <p className="text-xs font-bold text-primary mb-2.5 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-base">phone_iphone</span>
                <span>{lang === "fr" ? "Installation sur votre iPhone :" : "Install on your iPhone:"}</span>
              </p>

              <div className="space-y-2.5 text-xs text-on-surface">
                <div className="flex items-center gap-2.5 p-2 rounded-xl bg-white shadow-xs border border-surface-variant">
                  <span className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0 font-bold text-xs">
                    1
                  </span>
                  <div className="leading-snug">
                    {lang === "fr" ? (
                      <>
                        Touchez <strong>Partager</strong>{" "}
                        <span className="inline-flex align-middle text-primary font-bold">
                          <span className="material-symbols-outlined text-[17px]">ios_share</span>
                        </span>{" "}
                        <span className="text-on-surface-variant">(en bas de Safari)</span>
                      </>
                    ) : (
                      <>
                        Tap <strong>Share</strong>{" "}
                        <span className="inline-flex align-middle text-primary font-bold">
                          <span className="material-symbols-outlined text-[17px]">ios_share</span>
                        </span>{" "}
                        <span className="text-on-surface-variant">(bottom bar)</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2.5 p-2 rounded-xl bg-white shadow-xs border border-surface-variant">
                  <span className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0 font-bold text-xs">
                    2
                  </span>
                  <div className="leading-snug">
                    {lang === "fr" ? (
                      <>
                        Sélectionnez <strong>« Sur l&apos;écran d&apos;accueil »</strong>{" "}
                        <span className="inline-flex align-middle text-primary">
                          <span className="material-symbols-outlined text-[17px]">add_box</span>
                        </span>
                      </>
                    ) : (
                      <>
                        Select <strong>&quot;Add to Home Screen&quot;</strong>{" "}
                        <span className="inline-flex align-middle text-primary">
                          <span className="material-symbols-outlined text-[17px]">add_box</span>
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Animated pointing arrow toward bottom share bar in Safari */}
              <div className="mt-3 pt-2 border-t border-surface-variant flex items-center justify-center gap-1.5 text-primary text-xs font-bold animate-bounce">
                <span className="material-symbols-outlined text-base">arrow_downward</span>
                <span>{lang === "fr" ? "Regardez en bas de votre écran" : "Look at the bottom of your screen"}</span>
                <span className="material-symbols-outlined text-base">arrow_downward</span>
              </div>
            </div>

            <button
              onClick={handleMarkAsAlreadyInstalled}
              className="w-full py-2.5 rounded-xl bg-primary text-on-primary font-label-md text-sm font-semibold hover:opacity-90 active:scale-95 transition-all text-center"
            >
              {lang === "fr" ? "J'ai ajouté l'application" : "I added the app"}
            </button>

            <button
              onClick={handleMarkAsAlreadyInstalled}
              className="w-full py-2 text-on-surface-variant text-xs hover:underline text-center"
            >
              {lang === "fr" ? "L'application est déjà sur mon iPhone" : "App is already on my iPhone"}
            </button>
          </div>
        ) : (
          /* Android & Chrome / Edge: 1-Click Direct Installation */
          <div className="flex flex-col gap-2.5">
            <button
              onClick={handleInstallPwa}
              disabled={installing}
              className="w-full py-3.5 px-4 rounded-xl bg-primary text-on-primary font-label-md text-sm font-bold hover:opacity-95 active:scale-95 transition-all flex items-center justify-center gap-2 shadow-md disabled:opacity-60 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[22px]">
                {installing ? "hourglass_top" : "install_mobile"}
              </span>
              <span>
                {installing
                  ? lang === "fr"
                    ? "Installation en cours..."
                    : "Installing..."
                  : lang === "fr"
                  ? "Installer l'application"
                  : "Install Application"}
              </span>
            </button>

            <p className="text-[11px] text-center text-on-surface-variant">
              {lang === "fr"
                ? "S'installe instantanément sur votre écran d'accueil sans passer par le Play Store."
                : "Installs directly to your home screen without Play Store."}
            </p>

            <button
              onClick={handleMarkAsAlreadyInstalled}
              className="w-full py-2 text-primary font-label-sm text-xs font-semibold hover:bg-primary/5 rounded-lg transition-colors"
            >
              {lang === "fr" ? "L'application est déjà installée sur mon téléphone" : "App is already installed on my phone"}
            </button>

            <button
              onClick={handleDismiss}
              className="w-full py-1.5 text-on-surface-variant font-label-sm text-xs hover:bg-surface-variant/40 rounded-lg transition-colors"
            >
              {t("notNow")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
