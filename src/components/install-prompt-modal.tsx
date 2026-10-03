"use client";

import { useEffect, useState, useRef } from "react";
import { type Lang } from "@/lib/i18n/translations";

const DISMISSED_SESSION_KEY = "diva_pwa_dismissed_session";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface Window {
    __deferredInstallPrompt?: BeforeInstallPromptEvent | null;
  }
}

function isIosDevice(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/**
 * Determines if the current window is genuinely running inside the installed standalone PWA.
 * We deliberately DO NOT use email, user profile, database, or persistent localStorage
 * because a user can install, uninstall, and reinstall the application at any time.
 */
function isRunningInStandaloneApp(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true ||
    document.referrer.includes("android-app://") ||
    window.location.search.includes("mode=pwa")
  );
}

export function InstallPromptModal({ lang }: { lang: Lang }) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [manualGuide, setManualGuide] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Clear any obsolete permanent storage flag so users who uninstalled can always reinstall
    try {
      localStorage.removeItem("diva_pwa_installed");
    } catch {}

    // If currently running inside the installed standalone PWA window, hide modal
    if (isRunningInStandaloneApp()) {
      setIsStandalone(true);
      return;
    }

    const ios = isIosDevice();
    setIsIos(ios);

    if (sessionStorage.getItem(DISMISSED_SESSION_KEY)) {
      setDismissed(true);
    }

    // 1. Check if window.__deferredInstallPrompt was already caught in layout
    if (window.__deferredInstallPrompt) {
      setDeferredPrompt(window.__deferredInstallPrompt);
      deferredPromptRef.current = window.__deferredInstallPrompt;
      setReady(true);
    }

    // 2. Listen for beforeinstallprompt event
    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      const promptEvent = e as BeforeInstallPromptEvent;
      window.__deferredInstallPrompt = promptEvent;
      setDeferredPrompt(promptEvent);
      deferredPromptRef.current = promptEvent;
      setReady(true);
    }

    function onAppInstalled() {
      // Installed for this instance
      setDismissed(true);
      setDeferredPrompt(null);
      deferredPromptRef.current = null;
      window.__deferredInstallPrompt = null;
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);

    // Show prompt automatically after a short delay on both iOS and Android if not dismissed
    const timer = setTimeout(() => {
      setReady(true);
    }, 800);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  // When already running inside the installed standalone window, don't show the prompt
  if (isStandalone || (typeof window !== "undefined" && isRunningInStandaloneApp())) {
    return null;
  }

  function handleDismiss() {
    if (typeof window !== "undefined") {
      sessionStorage.setItem(DISMISSED_SESSION_KEY, "1");
    }
    setDismissed(true);
  }

  function handleReopen() {
    setDismissed(false);
  }

  async function handleAutoInstall() {
    setInstalling(true);

    try {
      if (isIos) {
        // On iOS, native Safari Home Screen shortcut is the official friction-free method
        return;
      }

      // Android / Chromium / Edge / Samsung Internet
      let promptEvent =
        deferredPrompt ||
        deferredPromptRef.current ||
        (typeof window !== "undefined" ? window.__deferredInstallPrompt : null);

      if (!promptEvent) {
        for (let i = 0; i < 5; i++) {
          await new Promise((resolve) => setTimeout(resolve, 150));
          promptEvent = window.__deferredInstallPrompt || deferredPromptRef.current;
          if (promptEvent) break;
        }
      }

      if (promptEvent) {
        await promptEvent.prompt();
        const choice = await promptEvent.userChoice;
        if (choice.outcome === "accepted") {
          setDismissed(true);
        }
      } else {
        // Fallback for browsers where beforeinstallprompt was already consumed or not fired
        setManualGuide(true);
      }
    } catch (err) {
      console.warn("[PWA] auto install error:", err);
    } finally {
      setInstalling(false);
    }
  }

  const modalVisible = ready && !dismissed && !isStandalone;

  return (
    <>
      {/* Floating install button if dismissed for the session but user is in web browser */}
      {ready && dismissed && !isStandalone && (
        <button
          onClick={handleReopen}
          aria-label={lang === "fr" ? "Installer l'application" : "Install App"}
          className="fixed bottom-20 md:bottom-6 right-4 z-40 bg-primary text-on-primary font-label-sm text-xs font-bold py-2.5 px-3.5 rounded-full shadow-lg border border-primary/20 flex items-center gap-1.5 hover:opacity-90 active:scale-95 transition-all cursor-pointer"
        >
          <span className="material-symbols-outlined text-[18px]">install_mobile</span>
          <span>{lang === "fr" ? "Installer l'application" : "Install App"}</span>
        </button>
      )}

      {/* Main Installation Modal */}
      {modalVisible && (
        <div
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs animate-in fade-in duration-200 p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl bg-surface p-5 sm:p-6 shadow-2xl relative border-t sm:border border-surface-variant max-h-[92vh] overflow-y-auto text-center">
            {/* Close button */}
            <button
              onClick={handleDismiss}
              aria-label={lang === "fr" ? "Fermer" : "Close"}
              className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-variant/50 transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>

            {/* App Icon + Title */}
            <div className="flex flex-col items-center mb-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/icons/icon-192.png"
                alt="DIVA Asso"
                className="w-16 h-16 object-contain rounded-2xl shadow-md border border-slate-100 mb-2.5"
              />
              <h2 className="font-title-md text-title-md text-primary font-bold leading-tight">
                DIVA Asso
              </h2>
              <p className="font-label-sm text-xs text-on-surface-variant mt-0.5">
                {lang === "fr"
                  ? "Application mobile officielle"
                  : "Official Mobile Application"}
              </p>
            </div>

            {/* iOS specific visual 3-step guide: No profile download, no iPhone Settings! */}
            {isIos ? (
              <div className="flex flex-col gap-2.5 text-left mt-2">
                <div className="bg-primary/5 border border-primary/20 rounded-xl p-2.5 text-center">
                  <p className="text-xs font-semibold text-primary">
                    {lang === "fr"
                      ? "📲 Installation directe sur iPhone"
                      : "📲 Direct install on iPhone"}
                  </p>
                  <p className="text-[11px] text-on-surface-variant mt-0.5">
                    {lang === "fr"
                      ? "Sans configuration dans les Réglages de l'iPhone !"
                      : "No setup needed in iPhone Settings!"}
                  </p>
                </div>

                <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-surface-container-low border border-surface-variant">
                  <span className="w-6 h-6 rounded-full bg-primary/10 text-primary font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                    1
                  </span>
                  <div className="text-xs">
                    <p className="font-semibold text-on-surface">
                      {lang === "fr" ? "Touchez Partager" : "Tap Share"}
                    </p>
                    <p className="text-on-surface-variant text-[11px] mt-0.5 leading-snug">
                      {lang === "fr" ? (
                        <>
                          En bas dans Safari, appuyez sur l&apos;icône <strong>Partager</strong> (le carré avec la flèche vers le haut <span className="material-symbols-outlined text-[14px] align-middle text-primary font-bold">ios_share</span>).
                        </>
                      ) : (
                        <>
                          At the bottom of Safari, tap the <strong>Share</strong> icon (<span className="material-symbols-outlined text-[14px] align-middle text-primary font-bold">ios_share</span>).
                        </>
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-surface-container-low border border-surface-variant">
                  <span className="w-6 h-6 rounded-full bg-primary/10 text-primary font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                    2
                  </span>
                  <div className="text-xs">
                    <p className="font-semibold text-on-surface">
                      {lang === "fr" ? "« Sur l'écran d'accueil »" : "« Add to Home Screen »"}
                    </p>
                    <p className="text-on-surface-variant text-[11px] mt-0.5 leading-snug">
                      {lang === "fr" ? (
                        <>
                          Faites défiler la liste vers le bas et touchez <strong>« Sur l&apos;écran d&apos;accueil »</strong> (avec le symbole <strong>+</strong>).
                        </>
                      ) : (
                        <>
                          Scroll down and tap <strong>« Add to Home Screen »</strong> (with the <strong>+</strong> icon).
                        </>
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-surface-container-low border border-surface-variant">
                  <span className="w-6 h-6 rounded-full bg-primary/10 text-primary font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                    3
                  </span>
                  <div className="text-xs">
                    <p className="font-semibold text-on-surface">
                      {lang === "fr" ? "Touchez « Ajouter »" : "Tap « Add »"}
                    </p>
                    <p className="text-on-surface-variant text-[11px] mt-0.5 leading-snug">
                      {lang === "fr" ? (
                        <>
                          En haut à droite, appuyez sur <strong>« Ajouter »</strong>. L&apos;icône Diva s&apos;affiche directement sur votre écran !
                        </>
                      ) : (
                        <>
                          In the top right, tap <strong>« Add »</strong>. Diva icon is added directly to your home screen!
                        </>
                      )}
                    </p>
                  </div>
                </div>

                <button
                  onClick={handleDismiss}
                  className="w-full mt-1.5 py-3 px-4 rounded-xl bg-primary text-on-primary font-label-md text-sm font-bold hover:opacity-95 active:scale-95 transition-all flex items-center justify-center gap-2 shadow-md cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[18px]">check_circle</span>
                  <span>{lang === "fr" ? "J'ai compris" : "Got it"}</span>
                </button>
              </div>
            ) : manualGuide ? (
              <div className="flex flex-col gap-2.5 text-left mt-2">
                <div className="bg-primary/5 border border-primary/20 rounded-xl p-2.5 text-center">
                  <p className="text-xs font-semibold text-primary">
                    {lang === "fr"
                      ? "Installation dans votre navigateur"
                      : "Install via your browser"}
                  </p>
                </div>
                <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-surface-container-low border border-surface-variant text-xs">
                  <span className="w-6 h-6 rounded-full bg-primary/10 text-primary font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                    1
                  </span>
                  <p className="text-on-surface leading-relaxed">
                    {lang === "fr" ? (
                      <>
                        Touchez le menu <strong>⋮</strong> (3 petits points en haut à droite de votre navigateur).
                      </>
                    ) : (
                      <>
                        Tap the <strong>⋮</strong> menu (3 dots at the top right of your browser).
                      </>
                    )}
                  </p>
                </div>
                <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-surface-container-low border border-surface-variant text-xs">
                  <span className="w-6 h-6 rounded-full bg-primary/10 text-primary font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                    2
                  </span>
                  <p className="text-on-surface leading-relaxed">
                    {lang === "fr" ? (
                      <>
                        Sélectionnez <strong>« Installer l&apos;application »</strong> ou <strong>« Ajouter à l&apos;écran d&apos;accueil »</strong>.
                      </>
                    ) : (
                      <>
                        Select <strong>« Install app »</strong> or <strong>« Add to Home screen »</strong>.
                      </>
                    )}
                  </p>
                </div>
                <button
                  onClick={handleDismiss}
                  className="w-full mt-1.5 py-3 px-4 rounded-xl bg-primary text-on-primary font-label-md text-sm font-bold hover:opacity-95 active:scale-95 transition-all flex items-center justify-center gap-2 shadow-md cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[18px]">check_circle</span>
                  <span>{lang === "fr" ? "J'ai compris" : "Got it"}</span>
                </button>
              </div>
            ) : (
              /* 1-Click Install Action for Android / Chromium */
              <div className="flex flex-col gap-2.5 mt-2">
                <button
                  onClick={handleAutoInstall}
                  disabled={installing}
                  className="w-full py-3.5 px-4 rounded-xl bg-primary text-on-primary font-label-md text-sm font-bold hover:opacity-95 active:scale-95 transition-all flex items-center justify-center gap-2 shadow-md disabled:opacity-60 cursor-pointer animate-pulse"
                >
                  <span className="material-symbols-outlined text-[22px]">
                    {installing ? "hourglass_top" : "install_mobile"}
                  </span>
                  <span>
                    {installing
                      ? lang === "fr"
                        ? "Lancement de l'installation..."
                        : "Starting installation..."
                      : lang === "fr"
                      ? "Installer l'application"
                      : "Install Application"}
                  </span>
                </button>

                <button
                  onClick={handleDismiss}
                  className="w-full py-2 text-on-surface-variant font-label-sm text-xs hover:bg-surface-variant/40 rounded-lg transition-colors cursor-pointer"
                >
                  {lang === "fr" ? "Plus tard" : "Not now"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
