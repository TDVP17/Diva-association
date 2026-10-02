"use client";

import { useEffect, useState } from "react";
import { type Lang } from "@/lib/i18n/translations";
import { urlBase64ToUint8Array } from "@/lib/push/client";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface Window {
    __deferredInstallPrompt?: BeforeInstallPromptEvent | null;
  }
}

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

function isCurrentlyInStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true ||
    document.referrer.includes("android-app://") ||
    window.location.search.includes("mode=pwa")
  );
}

export function PwaInstallCard({ lang }: { lang: Lang }) {
  const [isStandalone, setIsStandalone] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIos, setIsIos] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  // Push notification state
  const [pushSupported, setPushSupported] = useState(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission>("default");
  const [pushLoading, setPushLoading] = useState(false);
  const [pushSuccess, setPushSuccess] = useState(false);

  useEffect(() => {
    // Clear any obsolete permanent storage flag so users who uninstalled can always reinstall
    try {
      localStorage.removeItem("diva_pwa_installed");
    } catch {}

    // Check if the current page is running inside the standalone installed app window
    setIsStandalone(isCurrentlyInStandalone());

    // Detect iOS
    const ua = window.navigator.userAgent;
    const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && "ontouchend" in document);
    setIsIos(ios);

    // Capture install prompt for Android/Chrome/Edge
    function onBeforeInstall(e: Event) {
      e.preventDefault();
      const promptEvent = e as BeforeInstallPromptEvent;
      window.__deferredInstallPrompt = promptEvent;
      setDeferredPrompt(promptEvent);
    }

    function onAppInstalled() {
      // Installed now
      setDeferredPrompt(null);
      window.__deferredInstallPrompt = null;
    }

    if (window.__deferredInstallPrompt) {
      setDeferredPrompt(window.__deferredInstallPrompt);
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onAppInstalled);

    // Check push support
    if (typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window) {
      setPushSupported(true);
      setPushPermission(Notification.permission);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  async function handleInstallClick() {
    if (isIos) {
      // Toggle clear iOS Safari home screen instructions directly in the card
      setShowGuide((prev) => !prev);
      return;
    }

    setInstalling(true);
    try {
      // Android / Chromium / Edge / Samsung Internet
      let promptEvent =
        deferredPrompt ||
        (typeof window !== "undefined" ? window.__deferredInstallPrompt : null);

      if (!promptEvent) {
        for (let i = 0; i < 5; i++) {
          await new Promise((resolve) => setTimeout(resolve, 150));
          promptEvent = deferredPrompt || (typeof window !== "undefined" ? window.__deferredInstallPrompt : null);
          if (promptEvent) break;
        }
      }

      if (promptEvent) {
        await promptEvent.prompt();
        const choice = await promptEvent.userChoice;
        if (choice.outcome === "accepted") {
          setDeferredPrompt(null);
        }
      } else {
        // Fallback: show in-card instructions for Chrome/Android
        setShowGuide((prev) => !prev);
      }
    } catch (err) {
      console.warn("[pwa] install error:", err);
    } finally {
      setInstalling(false);
    }
  }

  async function handleEnablePush() {
    if (!VAPID_PUBLIC_KEY || !pushSupported) return;
    setPushLoading(true);
    try {
      const permission = await Notification.requestPermission();
      setPushPermission(permission);
      if (permission !== "granted") {
        setPushLoading(false);
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      });
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      setPushSuccess(true);
    } catch (err) {
      console.error("[pwa] Push enable error:", err);
    } finally {
      setPushLoading(false);
    }
  }

  return (
    <div className="w-full bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant p-4 flex flex-col gap-3">
      {isStandalone ? (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center flex-shrink-0">
              <span className="material-symbols-outlined text-2xl">verified</span>
            </div>
            <div>
              <p className="font-label-md text-label-md text-on-surface font-semibold">
                {lang === "fr" ? "Application installée & active" : "App Installed & Active"}
              </p>
              <p className="font-label-sm text-label-sm text-on-surface-variant">
                {lang === "fr"
                  ? "Vous utilisez DIVA en mode application mobile"
                  : "You are running DIVA as an installed mobile app"}
              </p>
            </div>
          </div>
          <span className="material-symbols-outlined text-emerald-600">check_circle</span>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                <span className="material-symbols-outlined text-2xl">install_mobile</span>
              </div>
              <div className="min-w-0">
                <p className="font-label-md text-label-md text-on-surface font-semibold truncate">
                  {lang === "fr" ? "Installer l'application" : "Install App"}
                </p>
                <p className="font-label-sm text-label-sm text-on-surface-variant text-xs">
                  {isIos
                    ? lang === "fr"
                      ? "Direct sur votre écran d'iPhone"
                      : "Direct on your iPhone screen"
                    : lang === "fr"
                    ? "Installation directe sur votre téléphone"
                    : "Direct installation on your phone"}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleInstallClick}
              disabled={installing}
              className="px-3.5 py-2 rounded-lg bg-primary text-on-primary font-label-sm text-label-sm hover:opacity-90 active:scale-95 transition-all flex items-center gap-1.5 flex-shrink-0 shadow-sm cursor-pointer disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-[16px]">
                {isIos ? (showGuide ? "close" : "ios_share") : installing ? "hourglass_top" : "download"}
              </span>
              {installing
                ? lang === "fr"
                  ? "Lancement..."
                  : "Starting..."
                : isIos
                ? showGuide
                  ? lang === "fr"
                    ? "Fermer"
                    : "Close"
                  : lang === "fr"
                  ? "Installer"
                  : "Install"
                : lang === "fr"
                ? "Installer"
                : "Install"}
            </button>
          </div>

          {/* Interactive in-card guide for iPhone or browsers needing manual action */}
          {showGuide && (
            <div className="p-3 bg-surface-container-low rounded-xl border border-primary/20 flex flex-col gap-2 animate-in fade-in duration-200">
              {isIos ? (
                <>
                  <p className="font-semibold text-xs text-primary flex items-center gap-1">
                    <span className="material-symbols-outlined text-[16px]">apple</span>
                    <span>{lang === "fr" ? "Installation rapide sur iPhone :" : "Quick install on iPhone:"}</span>
                  </p>
                  <div className="flex items-start gap-2 text-xs text-on-surface leading-snug">
                    <span className="font-bold text-primary shrink-0">1.</span>
                    <p>
                      {lang === "fr" ? (
                        <>
                          Touchez l&apos;icône <strong>Partager</strong> en bas de Safari (carré avec la flèche vers le haut <span className="material-symbols-outlined text-[13px] align-middle text-primary font-bold">ios_share</span>).
                        </>
                      ) : (
                        <>
                          Tap the <strong>Share</strong> icon at the bottom of Safari (<span className="material-symbols-outlined text-[13px] align-middle text-primary font-bold">ios_share</span>).
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex items-start gap-2 text-xs text-on-surface leading-snug">
                    <span className="font-bold text-primary shrink-0">2.</span>
                    <p>
                      {lang === "fr" ? (
                        <>
                          Faites défiler et touchez <strong>« Sur l&apos;écran d&apos;accueil »</strong> (icône <strong>+</strong>).
                        </>
                      ) : (
                        <>
                          Scroll down and tap <strong>« Add to Home Screen »</strong> (icon <strong>+</strong>).
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex items-start gap-2 text-xs text-on-surface leading-snug">
                    <span className="font-bold text-primary shrink-0">3.</span>
                    <p>
                      {lang === "fr" ? (
                        <>
                          Touchez <strong>« Ajouter »</strong> en haut à droite. C&apos;est tout !
                        </>
                      ) : (
                        <>
                          Tap <strong>« Add »</strong> in the top right. You&apos;re done!
                        </>
                      )}
                    </p>
                  </div>
                  <p className="text-[11px] text-on-surface-variant italic mt-1">
                    {lang === "fr"
                      ? "💡 Aucun paramétrage dans les Réglages de l'iPhone n'est nécessaire."
                      : "💡 No setup in iPhone Settings is required."}
                  </p>
                </>
              ) : (
                <>
                  <p className="font-semibold text-xs text-primary">
                    {lang === "fr" ? "Installation via votre navigateur :" : "Install via your browser:"}
                  </p>
                  <p className="text-xs text-on-surface leading-snug">
                    {lang === "fr" ? (
                      <>
                        1. Touchez les <strong>3 petits points ⋮</strong> en haut à droite de votre navigateur.<br />
                        2. Sélectionnez <strong>« Installer l&apos;application »</strong> ou <strong>« Ajouter à l&apos;écran d&apos;accueil »</strong>.
                      </>
                    ) : (
                      <>
                        1. Tap the <strong>3 dots ⋮</strong> in the top right of your browser.<br />
                        2. Select <strong>« Install app »</strong> or <strong>« Add to Home screen »</strong>.
                      </>
                    )}
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Push notifications button for mobile lock screen alerts */}
      {pushSupported && (
        <div className="pt-2 border-t border-surface-variant flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="material-symbols-outlined text-primary text-[20px] flex-shrink-0">
              notifications_active
            </span>
            <span className="font-label-sm text-label-sm text-on-surface truncate">
              {pushPermission === "granted" || pushSuccess
                ? lang === "fr"
                  ? "Alertes et notifications activées"
                  : "Alerts and notifications enabled"
                : lang === "fr"
                  ? "Activer les alertes sur ce téléphone"
                  : "Enable alerts on this phone"}
            </span>
          </div>
          {pushPermission !== "granted" && !pushSuccess ? (
            <button
              type="button"
              onClick={handleEnablePush}
              disabled={pushLoading}
              className="px-2.5 py-1 rounded-md border border-primary text-primary font-label-sm text-label-sm hover:bg-primary/5 active:scale-95 transition-all flex-shrink-0 disabled:opacity-50 cursor-pointer"
            >
              {pushLoading ? "..." : lang === "fr" ? "Activer" : "Enable"}
            </button>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-medium flex-shrink-0">
              <span className="material-symbols-outlined text-[14px]">check</span>
              {lang === "fr" ? "Actif" : "Active"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
