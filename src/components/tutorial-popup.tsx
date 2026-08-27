"use client";

import { useEffect, useState } from "react";
import { translate, type Lang } from "@/lib/i18n/translations";
import { TutorialVideoPlayer } from "@/components/tutorial-video-player";

const STATUS_KEY = "diva_tutorial_status"; // "dismissed" | "watched"
const LAST_PROMPTED_KEY = "diva_tutorial_last_prompted_at";
const NUDGE_SHOWN_THIS_SESSION_KEY = "diva_tutorial_nudge_shown";

const NUDGE_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const NUDGE_DELAY_MS = 5 * 60 * 1000; // 5 minutes of active use this session

type Variant = "welcome" | "nudge";

/**
 * Contextual help popup, not an ad: shown once to brand-new users, and — at
 * most once per browser session, with a 14-day cooldown — as a light nudge
 * for users who've been actively using the app a while without recently
 * seeing the tutorial. State lives in localStorage only (same pattern as
 * IosInstallBanner), since this is non-critical UI state, not something
 * that needs cross-device sync.
 */
export function TutorialPopup({ lang }: { lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  const [variant, setVariant] = useState<Variant | null>(null);
  const [showVideo, setShowVideo] = useState(false);

  useEffect(() => {
    const status = localStorage.getItem(STATUS_KEY);
    if (!status) {
      const handle = setTimeout(() => setVariant("welcome"), 0);
      return () => clearTimeout(handle);
    }

    if (sessionStorage.getItem(NUDGE_SHOWN_THIS_SESSION_KEY)) return;

    const lastPrompted = Number(localStorage.getItem(LAST_PROMPTED_KEY) ?? 0);
    const cooledDown = Date.now() - lastPrompted > NUDGE_COOLDOWN_MS;
    if (!cooledDown) return;

    const handle = setTimeout(() => {
      sessionStorage.setItem(NUDGE_SHOWN_THIS_SESSION_KEY, "1");
      setVariant("nudge");
    }, NUDGE_DELAY_MS);
    return () => clearTimeout(handle);
  }, []);

  function markPrompted() {
    localStorage.setItem(LAST_PROMPTED_KEY, String(Date.now()));
  }

  function dismiss() {
    localStorage.setItem(STATUS_KEY, "dismissed");
    markPrompted();
    setVariant(null);
    setShowVideo(false);
  }

  function watch() {
    localStorage.setItem(STATUS_KEY, "watched");
    markPrompted();
    setShowVideo(true);
  }

  if (!variant) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-container-padding"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-xl">
        {showVideo ? (
          <>
            <TutorialVideoPlayer lang={lang} />
            <button
              onClick={dismiss}
              className="w-full mt-4 py-2.5 rounded-lg border border-outline text-on-surface font-label-md text-label-md hover:bg-surface-variant/50 transition-colors"
            >
              {t("close")}
            </button>
          </>
        ) : (
          <>
            <h2 className="font-headline-sm text-headline-sm text-on-surface mb-2 text-center">
              {t(variant === "welcome" ? "tutorialWelcomeTitle" : "tutorialNudgeTitle")}
            </h2>
            <p className="font-body-md text-body-md text-on-surface-variant mb-6 text-center">
              {t(variant === "welcome" ? "tutorialWelcomeBody" : "tutorialNudgeBody")}
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={watch}
                className="w-full py-3 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-[20px]">play_circle</span>
                {t("watchTutorial")}
              </button>
              <button
                onClick={dismiss}
                className="w-full py-3 rounded-lg text-on-surface-variant font-label-md text-label-md hover:bg-surface-variant/50 transition-colors"
              >
                {t("notNow")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
