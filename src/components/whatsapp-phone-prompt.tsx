"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { translate, type Lang } from "@/lib/i18n/translations";

const DISMISSED_KEY = "diva_whatsapp_phone_prompt_dismissed";

export function WhatsAppPhonePrompt({ lang, hasPhone }: { lang: Lang; hasPhone: boolean }) {
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (hasPhone) return;
    const handle = setTimeout(() => {
      if (typeof window === "undefined") return;
      if (localStorage.getItem(DISMISSED_KEY)) return;
      setVisible(true);
    }, 1200);

    return () => clearTimeout(handle);
  }, [hasPhone]);

  function dismiss() {
    if (typeof window !== "undefined") {
      // Dismiss for the current session / day
      localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    }
    setVisible(false);
  }

  if (!visible || hasPhone) return null;

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 px-container-padding backdrop-blur-sm animate-in fade-in duration-200"
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

        <div className="flex flex-col items-center gap-3 mb-5">
          <div className="w-16 h-16 rounded-2xl bg-[#25D366]/15 text-[#128C7E] flex items-center justify-center shadow-inner">
            <span className="material-symbols-outlined text-[36px]">chat</span>
          </div>
          <h2 className="font-headline-sm text-headline-sm text-on-surface text-center font-bold">
            {t("whatsappPromptTitle")}
          </h2>
          <p className="font-body-md text-body-md text-on-surface-variant text-center leading-relaxed">
            {t("whatsappPromptBody")}
          </p>
        </div>

        <div className="flex flex-col gap-2.5">
          <Link
            href="/profile"
            onClick={dismiss}
            className="w-full py-3 px-4 rounded-xl bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2 shadow-sm font-semibold"
          >
            <span className="material-symbols-outlined text-[20px]">add_call</span>
            {t("whatsappPromptAction")}
          </Link>
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
