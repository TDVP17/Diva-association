"use client";

import { useEffect, useState } from "react";
import { translate, type Lang } from "@/lib/i18n/translations";

const DISMISSED_SESSION_KEY = "diva_pwa_dismissed_session";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isIosDevice(): boolean {
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
 * Universal PWA Installation Prompt for both iPhone and Android.
 * Automatically prompts installation when accessed via browser, ensuring
 * users can install the application with 1 tap or clear native steps.
 */
export function InstallPromptModal({ lang }: { lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [showAndroidManualHelp, setShowAndroidManualHelp] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isStandaloneAlready()) return;

    setIsIos(isIosDevice());

    if (sessionStorage.getItem(DISMISSED_SESSION_KEY)) {
      setDismissed(true);
    }

    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);

    // Auto-prompt quickly after page load
    const timer = setTimeout(() => {
      setReady(true);
    }, 800);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    };
  }, []);

  if (typeof window !== "undefined" && isStandaloneAlready()) {
    return null;
  }

  function handleDismiss() {
    if (typeof window !== "undefined") {
      sessionStorage.setItem(DISMISSED_SESSION_KEY, "1");
    }
    setDismissed(true);
  }

  function handleOpen() {
    setDismissed(false);
  }

  async function handleInstallPwa() {
    if (deferredPrompt) {
      setInstalling(true);
      try {
        await deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice.outcome === "accepted") {
          handleDismiss();
        }
      } catch (err) {
        console.error("[PWA] prompt error:", err);
      } finally {
        setInstalling(false);
      }
    } else {
      // If beforeinstallprompt hasn't fired or is not supported (e.g. Firefox Mobile)
      setShowAndroidManualHelp(true);
    }
  }

  const modalVisible = ready && !dismissed;

  return (
    <>
      {/* Floating Re-Open Button when dismissed but not yet installed */}
      {ready && dismissed && (
        <button
          onClick={handleOpen}
          aria-label={t("installApp")}
          className="fixed bottom-20 md:bottom-6 right-4 z-40 bg-primary text-on-primary font-label-sm text-xs font-bold py-2.5 px-3.5 rounded-full shadow-lg border border-primary/20 flex items-center gap-1.5 hover:opacity-90 active:scale-95 transition-all"
        >
          <span className="material-symbols-outlined text-[18px]">install_mobile</span>
          <span>{lang === "fr" ? "Installer l'application" : "Install App"}</span>
        </button>
      )}

      {/* Main Automatic Installation Modal */}
      {modalVisible && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-container-padding backdrop-blur-sm animate-in fade-in duration-200"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-2xl relative border border-surface-variant max-h-[90vh] overflow-y-auto">
            <button
              onClick={handleDismiss}
              aria-label={t("close")}
              className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-variant/50 transition-colors"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>

            <div className="flex flex-col items-center gap-2 mb-stack-gap-md text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/icons/icon-192.png"
                alt="DIVA Association"
                className="w-20 h-20 object-contain rounded-2xl shadow-md border border-slate-100"
              />
              <h2 className="font-title-md text-title-md text-primary font-bold">
                {t("browserInstallPromptTitle")}
              </h2>
              <p className="font-label-sm text-xs text-on-surface-variant leading-relaxed">
                {t("browserInstallPromptBanner")}
              </p>
            </div>

            {isIos ? (
              /* Specific iOS / Safari Walkthrough */
              <div className="flex flex-col gap-3">
                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-left flex flex-col gap-2">
                  <div className="flex items-center gap-1.5 text-primary font-bold text-xs">
                    <span className="material-symbols-outlined text-[18px]">phone_iphone</span>
                    <span>{t("iosInstallTitle")}</span>
                  </div>
                  <ol className="text-xs text-on-surface space-y-2 list-decimal list-inside leading-relaxed font-medium">
                    <li>
                      {lang === "fr" ? (
                        <>
                          Appuyez sur l&apos;icône <strong>Partager</strong>{" "}
                          <span className="inline-flex align-middle text-primary">
                            <span className="material-symbols-outlined text-[16px]">ios_share</span>
                          </span>{" "}
                          en bas de Safari.
                        </>
                      ) : (
                        <>
                          Tap the <strong>Share</strong> icon{" "}
                          <span className="inline-flex align-middle text-primary">
                            <span className="material-symbols-outlined text-[16px]">ios_share</span>
                          </span>{" "}
                          at the bottom of Safari.
                        </>
                      )}
                    </li>
                    <li>
                      {lang === "fr" ? (
                        <>
                          Faites défiler et sélectionnez <strong>« Sur l&apos;écran d&apos;accueil »</strong>{" "}
                          <span className="inline-flex align-middle text-primary">
                            <span className="material-symbols-outlined text-[16px]">add_box</span>
                          </span>.
                        </>
                      ) : (
                        <>
                          Scroll down and tap <strong>&quot;Add to Home Screen&quot;</strong>{" "}
                          <span className="inline-flex align-middle text-primary">
                            <span className="material-symbols-outlined text-[16px]">add_box</span>
                          </span>.
                        </>
                      )}
                    </li>
                    <li>
                      {lang === "fr" ? (
                        <>
                          Appuyez sur <strong>« Ajouter »</strong> en haut à droite.
                        </>
                      ) : (
                        <>
                          Tap <strong>&quot;Add&quot;</strong> in the top-right corner.
                        </>
                      )}
                    </li>
                  </ol>
                  <p className="text-[11px] text-on-surface-variant italic mt-1">
                    {lang === "fr"
                      ? "L'icône DIVA Association s'installera sur votre écran comme une application native sans navigateur."
                      : "DIVA Association will appear on your home screen as a full native app."}
                  </p>
                </div>

                <button
                  onClick={handleDismiss}
                  className="w-full py-2.5 rounded-xl bg-primary text-on-primary font-label-md text-label-md font-semibold hover:opacity-90 active:scale-95 transition-all text-center"
                >
                  {lang === "fr" ? "J'ai compris" : "Got it"}
                </button>
              </div>
            ) : (
              /* Android / Chrome / Edge 1-Click Install */
              <div className="flex flex-col gap-3">
                <button
                  onClick={handleInstallPwa}
                  disabled={installing}
                  className="w-full py-3.5 px-4 rounded-xl bg-primary text-on-primary font-label-md text-sm font-bold hover:opacity-95 active:scale-95 transition-all flex items-center justify-center gap-2 shadow-md disabled:opacity-60 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[22px]">install_mobile</span>
                  <span>
                    {installing
                      ? lang === "fr"
                        ? "Installation..."
                        : "Installing..."
                      : t("installApp")}
                  </span>
                </button>

                {showAndroidManualHelp && !deferredPrompt && (
                  <div className="p-3 rounded-xl bg-surface-container-low border border-surface-variant text-xs text-on-surface-variant leading-relaxed text-left">
                    <p className="font-semibold text-primary mb-1 flex items-center gap-1">
                      <span className="material-symbols-outlined text-[16px]">info</span>
                      {lang === "fr" ? "Installation manuelle :" : "Manual installation:"}
                    </p>
                    <p>
                      {lang === "fr"
                        ? "Appuyez sur le menu (les 3 points ⋮ en haut à droite de votre navigateur) puis choisissez « Installer l'application » ou « Ajouter à l'écran d'accueil »."
                        : "Tap the menu (3 dots ⋮ at top right of your browser) and select 'Install app' or 'Add to Home Screen'."}
                    </p>
                  </div>
                )}

                <button
                  onClick={handleDismiss}
                  className="w-full py-2 text-on-surface-variant font-label-sm text-xs hover:bg-surface-variant/40 rounded-lg transition-colors"
                >
                  {t("notNow")}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
