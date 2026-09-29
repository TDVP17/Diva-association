"use client";

import { useEffect, useState, useRef } from "react";
import { type Lang } from "@/lib/i18n/translations";

const DISMISSED_SESSION_KEY = "diva_pwa_dismissed_session";
const INSTALLED_KEY = "diva_pwa_installed";

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

function isStandaloneAlready(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true ||
    document.referrer.includes("android-app://") ||
    window.location.search.includes("mode=pwa") ||
    localStorage.getItem(INSTALLED_KEY) === "1"
  );
}

export function InstallPromptModal({ lang }: { lang: Lang }) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // If currently running as installed standalone PWA, completely hide prompt
    if (isStandaloneAlready()) {
      setIsInstalled(true);
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
      localStorage.setItem(INSTALLED_KEY, "1");
      setIsInstalled(true);
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

  // When already installed or running inside standalone app, do not allow installing again
  if (isInstalled || (typeof window !== "undefined" && isStandaloneAlready())) {
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
        // iOS: Directly trigger the native Apple MobileConfig profile download
        // iOS automatically displays the native system alert:
        // "Ce site web essaie de télécharger un profil de configuration. Voulez-vous l'autoriser ? [Autoriser]"
        // Zero tutorial text, 100% automated native trigger.
        localStorage.setItem(INSTALLED_KEY, "1");
        setIsInstalled(true);
        setDismissed(true);
        window.location.href = "/api/install/ios";
        return;
      }

      // Android / Chromium / Edge / Samsung Internet
      let promptEvent =
        deferredPrompt ||
        deferredPromptRef.current ||
        (typeof window !== "undefined" ? window.__deferredInstallPrompt : null);

      // If prompt is not ready yet, wait briefly for it
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
          localStorage.setItem(INSTALLED_KEY, "1");
          setIsInstalled(true);
          setDismissed(true);
        }
      } else {
        // Fallback for browsers without beforeinstallprompt: trigger iOS webclip or direct installation
        localStorage.setItem(INSTALLED_KEY, "1");
        window.location.href = "/api/install/ios";
      }
    } catch (err) {
      console.warn("[PWA] auto install error:", err);
    } finally {
      setInstalling(false);
    }
  }

  const modalVisible = ready && !dismissed && !isInstalled;

  return (
    <>
      {/* Floating install button if dismissed but not installed */}
      {ready && dismissed && !isInstalled && (
        <button
          onClick={handleReopen}
          aria-label={lang === "fr" ? "Installer l'application" : "Install App"}
          className="fixed bottom-20 md:bottom-6 right-4 z-40 bg-primary text-on-primary font-label-sm text-xs font-bold py-2.5 px-3.5 rounded-full shadow-lg border border-primary/20 flex items-center gap-1.5 hover:opacity-90 active:scale-95 transition-all cursor-pointer"
        >
          <span className="material-symbols-outlined text-[18px]">install_mobile</span>
          <span>{lang === "fr" ? "Installer l'application" : "Install App"}</span>
        </button>
      )}

      {/* Main Installation Modal: Immediate 1-click install, zero tutorial steps */}
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
            <div className="flex flex-col items-center mb-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/icons/icon-192.png"
                alt="DIVA Association"
                className="w-16 h-16 object-contain rounded-2xl shadow-md border border-slate-100 mb-2.5"
              />
              <h2 className="font-title-md text-title-md text-primary font-bold leading-tight">
                Diva Association
              </h2>
              <p className="font-label-sm text-xs text-on-surface-variant mt-0.5">
                {lang === "fr"
                  ? "Application mobile officielle"
                  : "Official Mobile Application"}
              </p>
            </div>

            {/* 1-Click Install Action: Automatically triggers native install without any manual tutorial */}
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
          </div>
        </div>
      )}
    </>
  );
}
