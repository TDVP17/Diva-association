"use client";

import { useEffect, useState } from "react";
import { translate, type Lang } from "@/lib/i18n/translations";

const DISMISSED_KEY = "diva_install_modal_dismissed";
const DECISION_DELAY_MS = 1500;
const ANDROID_APK_URL = process.env.NEXT_PUBLIC_ANDROID_APK_URL || "/downloads/diva-association.apk";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isIosSafariLikely(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && "ontouchend" in document);
}

function isStandaloneAlready(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Notifies visitors using a browser on their phone/desktop to install the PWA
 * or download the APK directly, ensuring they can receive notifications and fast access.
 */
export function InstallPromptModal({ lang }: { lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    let removeListener: (() => void) | undefined;
    let readyHandle: ReturnType<typeof setTimeout> | undefined;

    const setupHandle = setTimeout(() => {
      if (typeof window === "undefined") return;
      if (localStorage.getItem(DISMISSED_KEY)) {
        setDismissed(true);
        return;
      }
      if (isStandaloneAlready()) return;

      setIsIos(isIosSafariLikely());

      function handler(e: Event) {
        e.preventDefault();
        setDeferredPrompt(e as BeforeInstallPromptEvent);
      }
      window.addEventListener("beforeinstallprompt", handler);
      removeListener = () => window.removeEventListener("beforeinstallprompt", handler);

      readyHandle = setTimeout(() => setReady(true), DECISION_DELAY_MS);
    }, 0);

    return () => {
      clearTimeout(setupHandle);
      if (readyHandle) clearTimeout(readyHandle);
      removeListener?.();
    };
  }, []);

  const visible = ready && !dismissed && !isStandaloneAlready();

  function dismiss() {
    if (typeof window !== "undefined") {
      localStorage.setItem(DISMISSED_KEY, "1");
    }
    setDismissed(true);
  }

  async function handleInstallPwa() {
    if (!deferredPrompt) return;
    setInstalling(true);
    try {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
    } finally {
      setInstalling(false);
      dismiss();
    }
  }

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-container-padding backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-2xl relative border border-surface-variant">
        <button
          onClick={dismiss}
          aria-label={t("close")}
          className="absolute top-3 right-3 w-9 h-9 flex items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-variant/50 transition-colors"
        >
          <span className="material-symbols-outlined text-[20px]">close</span>
        </button>

        <div className="flex flex-col items-center gap-2 mb-stack-gap-lg">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/brand-lockup.png" alt="Diva Association" className="w-24 h-24 object-contain rounded-2xl shadow-sm" />
          <h2 className="font-headline-sm text-headline-sm text-on-surface text-center font-bold">
            {t("browserInstallPromptTitle")}
          </h2>
          <p className="font-body-md text-body-md text-on-surface-variant text-center">
            {t("browserInstallPromptBanner")}
          </p>
        </div>

        <div className="flex flex-col gap-2.5">
          <a
            href={ANDROID_APK_URL}
            download
            onClick={dismiss}
            className="w-full py-3 px-4 rounded-xl bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2 shadow-sm font-semibold"
          >
            <span className="material-symbols-outlined text-[20px]">android</span>
            {t("downloadAndroidApk")}
          </a>

          {deferredPrompt ? (
            <button
              onClick={handleInstallPwa}
              disabled={installing}
              className="w-full py-3 px-4 rounded-xl border-2 border-primary text-primary font-label-md text-label-md hover:bg-primary/5 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-60 font-semibold"
            >
              <span className="material-symbols-outlined text-[20px]">install_mobile</span>
              {t("installApp")}
            </button>
          ) : isIos ? (
            <div className="p-3 rounded-xl bg-surface-container-low border border-surface-variant text-left">
              <div className="flex items-center gap-2 text-primary font-medium text-xs mb-1">
                <span className="material-symbols-outlined text-[18px]">ios_share</span>
                {t("iosInstallTitle")}
              </div>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                {t("iosInstallSteps")}
              </p>
            </div>
          ) : null}

          <button
            onClick={dismiss}
            className="w-full py-2.5 rounded-lg text-on-surface-variant font-label-md text-label-md hover:bg-surface-variant/50 transition-colors"
          >
            {t("notNow")}
          </button>
        </div>
      </div>
    </div>
  );
}
