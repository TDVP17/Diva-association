"use client";

import { useEffect, useState } from "react";
import { translate, type Lang } from "@/lib/i18n/translations";
import { TutorialVideoPlayer } from "@/components/tutorial-video-player";

const STATUS_KEY = "diva_tutorial_status"; // "dismissed" | "watched"

/**
 * One-time welcome popup for brand-new users who have never seen the tutorial.
 * Once the user dismisses or watches the tutorial, it is never shown again.
 */
export function TutorialPopup({ lang }: { lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  const [visible, setVisible] = useState(false);
  const [showVideo, setShowVideo] = useState(false);

  useEffect(() => {
    const status = localStorage.getItem(STATUS_KEY);
    if (!status) {
      // Brand-new user — show the welcome popup immediately
      setVisible(true);
    }
    // Otherwise: already dismissed or watched → never show again
  }, []);

  function dismiss() {
    localStorage.setItem(STATUS_KEY, "dismissed");
    setVisible(false);
    setShowVideo(false);
  }

  function watch() {
    localStorage.setItem(STATUS_KEY, "watched");
    setShowVideo(true);
  }

  if (!visible) return null;

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
              {t("tutorialWelcomeTitle")}
            </h2>
            <p className="font-body-md text-body-md text-on-surface-variant mb-6 text-center">
              {t("tutorialWelcomeBody")}
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
