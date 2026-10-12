"use client";

import { useState } from "react";
import { translate, type Lang } from "@/lib/i18n/translations";

export function PaymentToastBanner({
  sessionLabel,
  payerName,
  lang,
}: {
  sessionLabel: string;
  payerName?: string | null;
  lang: Lang;
}) {
  const [dismissed, setDismissed] = useState(false);
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);

  if (!payerName || dismissed) return null;

  const initials = payerName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "M";

  return (
    <aside
      aria-label={lang === "fr" ? "Notification de cotisation" : "Contribution notification"}
      className="mb-4 w-full flex items-center justify-between gap-3 bg-slate-900/95 text-white backdrop-blur-md rounded-2xl px-4 py-3 shadow-xl border border-slate-700/60 animate-in fade-in slide-in-from-top-4 duration-300"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 rounded-full bg-emerald-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0 shadow-xs">
          {initials}
        </div>
        <div className="min-w-0">
          <p className="text-xs sm:text-sm font-bold text-white truncate">
            {payerName} • {sessionLabel}
          </p>
          <p className="text-[11px] sm:text-xs text-emerald-300 italic truncate font-medium">
            {t("memberPaidCelebrationQuote")}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors flex-shrink-0"
        aria-label={t("close")}
      >
        <span className="material-symbols-outlined text-[18px]">close</span>
      </button>
    </aside>
  );
}
