"use client";

import { useEffect, useState } from "react";
import { translate, type Lang } from "@/lib/i18n/translations";

const DISMISSED_KEY = "diva_ios_install_dismissed";

/** iOS has no beforeinstallprompt API — Safari/Chrome-on-iOS both need manual "Add to Home Screen" instructions. */
function isIosSafariLikely(): boolean {
  const ua = window.navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && "ontouchend" in document);
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return isIos && !isStandalone;
}

export function IosInstallBanner({ lang }: { lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handle = setTimeout(() => {
      if (localStorage.getItem(DISMISSED_KEY)) return;
      if (isIosSafariLikely()) setVisible(true);
    }, 0);
    return () => clearTimeout(handle);
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, "1");
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="fixed bottom-20 md:bottom-4 left-4 right-4 z-40 max-w-md mx-auto bg-white rounded-xl shadow-[0px_8px_30px_rgba(30,41,59,0.15)] border border-surface-variant p-4 flex gap-3">
      <span className="material-symbols-outlined text-primary text-2xl flex-shrink-0">ios_share</span>
      <div className="flex-1 min-w-0">
        <p className="font-label-md text-label-md text-on-surface">{t("iosInstallTitle")}</p>
        <p className="font-label-sm text-label-sm text-on-surface-variant mt-1">{t("iosInstallSteps")}</p>
      </div>
      <button
        onClick={dismiss}
        aria-label={t("cancel")}
        className="text-outline hover:text-primary transition-colors flex-shrink-0"
      >
        <span className="material-symbols-outlined text-[20px]">close</span>
      </button>
    </div>
  );
}
