"use client";

import { useEffect } from "react";
import { translate } from "@/lib/i18n/translations";
import { getClientLang } from "@/lib/i18n/get-lang-client";

/**
 * Shared fallback for every error.tsx/global-error.tsx boundary in the app
 * — logs the real error for diagnosis, but only ever shows the user a
 * plain bilingual message, never a raw stack trace or technical string
 * (500/502, "TypeError: Failed to fetch", OAuth callback errors, etc.).
 */
export function FriendlyError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const lang = getClientLang();
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);

  useEffect(() => {
    console.error("[error boundary]", error);
  }, [error]);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background px-container-padding text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/icon-512.png" alt="DIVA Association" className="w-16 h-16 rounded-2xl shadow-md" />
      <span className="material-symbols-outlined text-error text-4xl">error</span>
      <p className="font-body-md text-body-md text-on-surface-variant max-w-sm">{t("somethingWentWrong")}</p>
      <button
        onClick={reset}
        className="py-2.5 px-5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 active:scale-95 transition-all"
      >
        {t("tryAgain")}
      </button>
    </main>
  );
}
