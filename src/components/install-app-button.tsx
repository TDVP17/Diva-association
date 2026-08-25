"use client";

import { useEffect, useState } from "react";
import { translate, type Lang } from "@/lib/i18n/translations";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallAppButton({ lang }: { lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    function handler(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!deferredPrompt) return null;

  async function handleInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  }

  return (
    <button
      onClick={handleInstall}
      className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-white shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant hover:bg-surface-container-low transition-colors"
    >
      <span className="flex items-center gap-3">
        <span className="material-symbols-outlined text-primary">install_mobile</span>
        <span className="text-left">
          <span className="block font-label-md text-label-md text-on-surface">{t("installApp")}</span>
          <span className="block font-label-sm text-label-sm text-on-surface-variant">
            {t("installAppDescription")}
          </span>
        </span>
      </span>
      <span className="material-symbols-outlined text-outline">chevron_right</span>
    </button>
  );
}
