"use client";

import { useEffect, useState } from "react";
import { translate, type Lang } from "@/lib/i18n/translations";
import { urlBase64ToUint8Array } from "@/lib/push/client";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

export function PwaInstallCard({ lang }: { lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);

  const [isStandalone, setIsStandalone] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIos, setIsIos] = useState(false);
  const [showModal, setShowModal] = useState(false);

  // Push notification state
  const [pushSupported, setPushSupported] = useState(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission>("default");
  const [pushLoading, setPushLoading] = useState(false);
  const [pushSuccess, setPushSuccess] = useState(false);

  useEffect(() => {
    // Detect standalone mode
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    setIsStandalone(standalone);

    // Detect iOS
    const ua = window.navigator.userAgent;
    const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && "ontouchend" in document);
    setIsIos(ios);

    // Capture install prompt for Android/Chrome/Edge
    function onBeforeInstall(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    // Check push support
    if (typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window) {
      setPushSupported(true);
      setPushPermission(Notification.permission);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
    };
  }, []);

  async function handleInstallClick() {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        setDeferredPrompt(null);
      }
    } else {
      setShowModal(true);
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
    <>
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
                    ? "DIVA est prête sur votre écran d'accueil"
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
                  {lang === "fr" ? "Installer l'application sur le téléphone" : "Install App on your Phone"}
                </p>
                <p className="font-label-sm text-label-sm text-on-surface-variant text-xs">
                  {lang === "fr"
                    ? "Compatible iPhone & Android sans Play Store"
                    : "Compatible with iPhone & Android without store"}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleInstallClick}
              className="px-3.5 py-2 rounded-lg bg-primary text-on-primary font-label-sm text-label-sm hover:opacity-90 active:scale-95 transition-all flex items-center gap-1.5 flex-shrink-0 shadow-sm"
            >
              <span className="material-symbols-outlined text-[16px]">download</span>
              {lang === "fr" ? "Installer" : "Install"}
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
                className="px-2.5 py-1 rounded-md border border-primary text-primary font-label-sm text-label-sm hover:bg-primary/5 active:scale-95 transition-all flex-shrink-0 disabled:opacity-50"
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

      {/* Guided installation modal for iOS / manual browsers */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-2xl shadow-2xl max-w-sm w-full p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-primary font-title-sm text-title-sm font-bold">
                <span className="material-symbols-outlined">
                  {isIos ? "phone_iphone" : "phone_android"}
                </span>
                {isIos
                  ? lang === "fr"
                    ? "Installation sur iPhone"
                    : "Install on iPhone"
                  : lang === "fr"
                    ? "Installation sur Android"
                    : "Install on Android"}
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-on-surface-variant hover:text-on-surface"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <p className="font-body-sm text-body-sm text-on-surface-variant">
              {isIos
                ? lang === "fr"
                  ? "Suivez ces 2 étapes simples dans le navigateur Safari pour ajouter l'application sur votre écran d'accueil :"
                  : "Follow these 2 easy steps in Safari to add the app to your Home Screen:"
                : lang === "fr"
                  ? "Dans votre navigateur (Chrome, etc.), suivez ces étapes :"
                  : "In your browser (Chrome, etc.), follow these steps:"}
            </p>

            <div className="flex flex-col gap-3 bg-surface-container-low p-4 rounded-xl border border-surface-variant text-sm">
              {isIos ? (
                <>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary text-on-primary flex items-center justify-center font-bold text-xs flex-shrink-0">
                      1
                    </div>
                    <div>
                      <p className="font-semibold text-on-surface flex items-center gap-1">
                        {lang === "fr" ? "Appuyez sur Partager" : "Tap Share"}
                        <span className="material-symbols-outlined text-[18px] text-primary">ios_share</span>
                      </p>
                      <p className="text-on-surface-variant text-xs mt-0.5">
                        {lang === "fr"
                          ? "En bas de votre écran Safari."
                          : "At the bottom of your Safari screen."}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary text-on-primary flex items-center justify-center font-bold text-xs flex-shrink-0">
                      2
                    </div>
                    <div>
                      <p className="font-semibold text-on-surface flex items-center gap-1">
                        {lang === "fr" ? "« Sur l'écran d'accueil »" : "'Add to Home Screen'"}
                        <span className="material-symbols-outlined text-[18px] text-primary">add_to_home_screen</span>
                      </p>
                      <p className="text-on-surface-variant text-xs mt-0.5">
                        {lang === "fr"
                          ? "Faites défiler le menu puis confirmez avec « Ajouter »."
                          : "Scroll down the menu and tap 'Add'."}
                      </p>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary text-on-primary flex items-center justify-center font-bold text-xs flex-shrink-0">
                      1
                    </div>
                    <div>
                      <p className="font-semibold text-on-surface flex items-center gap-1">
                        {lang === "fr" ? "Appuyez sur le menu" : "Tap the menu"}
                        <span className="material-symbols-outlined text-[18px] text-primary">more_vert</span>
                      </p>
                      <p className="text-on-surface-variant text-xs mt-0.5">
                        {lang === "fr"
                          ? "Les 3 points verticaux en haut à droite du navigateur."
                          : "The 3 dots at the top right of your browser."}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary text-on-primary flex items-center justify-center font-bold text-xs flex-shrink-0">
                      2
                    </div>
                    <div>
                      <p className="font-semibold text-on-surface flex items-center gap-1">
                        {lang === "fr" ? "« Installer l'application »" : "'Install App'"}
                        <span className="material-symbols-outlined text-[18px] text-primary">install_mobile</span>
                      </p>
                      <p className="text-on-surface-variant text-xs mt-0.5">
                        {lang === "fr"
                          ? "Ou « Ajouter à l'écran d'accueil »."
                          : "Or 'Add to Home Screen'."}
                      </p>
                    </div>
                  </div>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowModal(false)}
              className="w-full py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 active:scale-95 transition-all text-center"
            >
              {lang === "fr" ? "J'ai compris" : "Got it"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
