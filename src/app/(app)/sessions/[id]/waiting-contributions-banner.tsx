"use client";

import { useState, useEffect } from "react";
import { playUiTapSound } from "@/lib/sound-effects";
import type { Lang } from "@/lib/i18n/translations";

interface WaitingContributionsBannerProps {
  sessionId: string;
  dueDateStr: string;
  paidCount: number;
  totalSlotsCount: number;
  lang: Lang;
}

export function WaitingContributionsBanner({
  sessionId,
  dueDateStr,
  paidCount,
  totalSlotsCount,
  lang,
}: WaitingContributionsBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const storageKey = `diva_dismiss_waiting_${sessionId}_${dueDateStr}`;

  useEffect(() => {
    try {
      if (sessionStorage.getItem(storageKey) === "1") {
        setDismissed(true);
      }
    } catch {}
  }, [storageKey]);

  if (dismissed) return null;

  function handleDismiss() {
    playUiTapSound();
    try {
      sessionStorage.setItem(storageKey, "1");
    } catch {}
    setDismissed(true);
  }

  return (
    <div className="mb-stack-gap-lg rounded-2xl border border-emerald-500/30 bg-emerald-50/70 p-4 text-emerald-950 flex items-start gap-3 shadow-xs relative">
      <span className="material-symbols-outlined text-emerald-700 text-[24px] flex-shrink-0 mt-0.5">
        hourglass_empty
      </span>
      <div className="min-w-0 flex-1 pr-7">
        <h4 className="font-label-md text-sm font-bold text-emerald-950">
          {lang === "fr" ? "Ordre de bouffe : En attente des cotisations" : "Payout Turn: Waiting for Contributions"}
        </h4>
        <p className="font-body-sm text-xs text-emerald-900/90 mt-1 leading-relaxed">
          {lang === "fr"
            ? `L'envoi de vos coordonnées de paiement s'activera dès que tout le monde aura cotisé (${paidCount}/${totalSlotsCount} cotisations reçues). N'oubliez pas que tout le monde, y compris vous-même pour vos parts, a l'obligation de cotiser !`
            : `The prompt to provide your payout details will activate once all members have contributed (${paidCount}/${totalSlotsCount} contributions received). Remember that everyone, including yourself for your parts, must contribute!`}
        </p>
        <div className="mt-2.5 flex items-center gap-2">
          <button
            type="button"
            onClick={handleDismiss}
            className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 hover:text-emerald-950 hover:underline cursor-pointer"
          >
            <span className="material-symbols-outlined text-[14px]">close</span>
            <span>{lang === "fr" ? "Effacer ce message" : "Dismiss this message"}</span>
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label={lang === "fr" ? "Effacer" : "Dismiss"}
        title={lang === "fr" ? "Effacer" : "Dismiss"}
        className="absolute top-3 right-3 p-1 rounded-lg text-emerald-800/60 hover:text-emerald-950 hover:bg-emerald-100 transition-colors cursor-pointer"
      >
        <span className="material-symbols-outlined text-[18px]">close</span>
      </button>
    </div>
  );
}
