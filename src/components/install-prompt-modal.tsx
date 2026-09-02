"use client";

import { useEffect, useState } from "react";
import { translate, type Lang } from "@/lib/i18n/translations";

const DISMISSED_KEY = "diva_install_modal_dismissed";
// Long enough for `beforeinstallprompt` to have fired if it's going to
// (it typically fires shortly after load) before we decide whether the PWA
// option should be part of this one-time prompt — see AndroidApkButton for
// why the APK side is a no-op until NEXT_PUBLIC_ANDROID_APK_URL is set.
const DECISION_DELAY_MS = 1500;
const ANDROID_APK_URL = process.env.NEXT_PUBLIC_ANDROID_APK_URL;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isIosSafariLikely(): boolean {
  const ua = window.navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && "ontouchend" in document);
  return isIos;
}

function isStandaloneAlready(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * One-time "Welcome! Get the full DIVA experience" prompt for browser
 * visitors — combines the PWA install trigger and the APK download link
 * (when configured) in a single modal instead of leaving both buried on
 * the Profile page. Skips iOS entirely (IosInstallBanner already covers
 * it with its own manual-steps flow) and anyone already running the
 * installed PWA.
 */
export function InstallPromptModal({ lang }: { lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    let removeListener: (() => void) | undefined;
    let readyHandle: ReturnType<typeof setTimeout> | undefined;

    // Deferred a tick so the localStorage/UA checks below (which may call
    // setDismissed) never run synchronously in the effect body itself.
    const setupHandle = setTimeout(() => {
      if (localStorage.getItem(DISMISSED_KEY)) {
        setDismissed(true);
        return;
      }
      if (isIosSafariLikely() || isStandaloneAlready()) return;

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

  // Derived, not synced via a second effect — the modal is visible exactly
  // when we're done waiting for beforeinstallprompt AND at least one
  // install option turned out to be available AND the user hasn't
  // dismissed it (this session or a previous one).
  const visible = ready && !dismissed && (!!deferredPrompt || !!ANDROID_APK_URL);

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, "1");
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
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-container-padding"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-xl relative">
        <button
          onClick={dismiss}
          aria-label={t("close")}
          className="absolute top-3 right-3 w-9 h-9 flex items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-variant/50 transition-colors"
        >
          <span className="material-symbols-outlined text-[20px]">close</span>
        </button>

        <div className="flex flex-col items-center gap-2 mb-stack-gap-lg">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-512.png" alt="" className="w-16 h-16 rounded-2xl shadow-sm" />
          <h2 className="font-headline-sm text-headline-sm text-on-surface text-center">{t("installModalTitle")}</h2>
          <p className="font-body-md text-body-md text-on-surface-variant text-center">{t("installModalBody")}</p>
        </div>

        <div className="flex flex-col gap-2">
          {!!ANDROID_APK_URL && (
            <a
              href={ANDROID_APK_URL}
              download
              onClick={dismiss}
              className="w-full py-3 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-[20px]">android</span>
              {t("downloadAndroidApk")}
            </a>
          )}
          {!!deferredPrompt && (
            <button
              onClick={handleInstallPwa}
              disabled={installing}
              className="w-full py-3 rounded-lg border border-primary text-primary font-label-md text-label-md hover:bg-primary/5 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-[20px]">install_mobile</span>
              {t("installApp")}
            </button>
          )}
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
