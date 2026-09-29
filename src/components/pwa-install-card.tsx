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

export function PwaInstallCard({ lang }: { lang: Lang }) {
  const [isStandalone, setIsStandalone] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIos, setIsIos] = useState(false);
  const [installing, setInstalling] = useState(false);

  // Push notification state
  const [pushSupported, setPushSupported] = useState(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission>("default");
  const [pushLoading, setPushLoading] = useState(false);
  const [pushSuccess, setPushSuccess] = useState(false);

  useEffect(() => {
    const installedFromStorage =
      typeof window !== "undefined" && localStorage.getItem("diva_pwa_installed") === "1";
    // Detect standalone mode
    const standalone =
      (typeof window !== "undefined" && window.matchMedia("(display-mode: standalone)").matches) ||
      (typeof window !== "undefined" &&
        (window.navigator as Navigator & { standalone?: boolean }).standalone === true) ||
      installedFromStorage;

    setIsStandalone(standalone);

    if (typeof window !== "undefined" && "getInstalledRelatedApps" in navigator) {
      (navigator as Navigator & { getInstalledRelatedApps?: () => Promise<unknown[]> })
        .getInstalledRelatedApps?.()
        .then((apps) => {
          if (apps && apps.length > 0) {
            localStorage.setItem("diva_pwa_installed", "1");
            setIsStandalone(true);
          }
        })
        .catch(() => {});
    }

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
      localStorage.setItem("diva_pwa_installed", "1");
      setIsStandalone(true);
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
    setInstalling(true);

    try {
      if (isIos) {
        // Direct iOS native mobileconfig profile download:
        // Automatically triggers the native iOS dialog without any tutorial
        localStorage.setItem("diva_pwa_installed", "1");
        setIsStandalone(true);
        window.location.href = "/api/install/ios";
        return;
      }

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
          localStorage.setItem("diva_pwa_installed", "1");
          setIsStandalone(true);
          setDeferredPrompt(null);
        }
      } else {
        // Fallback for browsers without beforeinstallprompt
        localStorage.setItem("diva_pwa_installed", "1");
        window.location.href = "/api/install/ios";
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
                {lang === "fr" ? "Application installée" : "App Installed"}
              </p>
              <p className="font-label-sm text-label-sm text-on-surface-variant">
                {lang === "fr"
                  ? "DIVA est déjà installée sur votre appareil"
                  : "DIVA is installed on your device"}
              </p>
            </div>
          </div>
          <span className="material-symbols-outlined text-emerald-600">check_circle</span>
        </div>
      ) : (
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
                {lang === "fr"
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
              {installing ? "hourglass_top" : "download"}
            </span>
            {installing
              ? lang === "fr"
                ? "Lancement..."
                : "Starting..."
              : lang === "fr"
              ? "Installer"
              : "Install"}
          </button>
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
