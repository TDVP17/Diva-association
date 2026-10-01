"use client";

import { useState } from "react";
import { formatXAF } from "@/lib/format-currency";

interface FineRulePillProps {
  fineAmount: number;
  fineIntervalHours: number;
  limitTime: string;
  lang: string;
}

export function FineRulePill({
  fineAmount,
  fineIntervalHours,
  limitTime,
  lang,
}: FineRulePillProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="mt-1.5 max-w-md relative z-20">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsOpen((prev) => !prev);
        }}
        className="cursor-pointer inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200/70 text-[11px] font-medium hover:bg-amber-100 transition-colors shadow-2xs"
        aria-expanded={isOpen}
      >
        <span className="material-symbols-outlined text-[13px]">gavel</span>
        <span>{lang === "fr" ? "Règles des amendes" : "Fine rules"}</span>
        <span className="font-semibold">({formatXAF(fineAmount)})</span>
      </button>
      {isOpen && (
        <div
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          className="font-body-sm text-[11px] text-on-surface-variant/90 mt-1 bg-amber-50/95 p-2 rounded border border-amber-200/80 leading-relaxed shadow-sm"
        >
          {lang === "fr"
            ? `Amende de ${formatXAF(fineAmount)} après ${limitTime}, puis toutes les ${fineIntervalHours}h si le paiement n'est pas fait.`
            : `Fine of ${formatXAF(fineAmount)} after ${limitTime}, then every ${fineIntervalHours}h if unpaid.`}
        </div>
      )}
    </div>
  );
}
