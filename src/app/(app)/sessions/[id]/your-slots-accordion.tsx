"use client";

import { useState, type ReactNode } from "react";
import type { Lang } from "@/lib/i18n/translations";

interface YourSlotsAccordionProps {
  lang: Lang;
  title: string;
  slotsCount: number;
  paidCount: number;
  children: ReactNode;
}

export function YourSlotsAccordion({
  lang,
  title,
  slotsCount,
  paidCount,
  children,
}: YourSlotsAccordionProps) {
  // Fermé par défaut selon la demande
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="mb-stack-gap-lg bg-surface rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-4 flex items-center justify-between hover:bg-surface-container-low transition-colors cursor-pointer text-left"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-[22px]">badge</span>
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-title-sm text-title-sm text-primary font-bold">
                {title}
              </h2>
              <span className="font-label-sm text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                {slotsCount} {slotsCount > 1 ? (lang === "fr" ? "noms" : "slots") : (lang === "fr" ? "nom" : "slot")}
              </span>
              {paidCount > 0 && (
                <span className="font-label-sm text-xs px-2 py-0.5 rounded-full bg-[#d1fae5] text-[#065f46] font-medium flex items-center gap-1">
                  <span className="material-symbols-outlined text-[13px]">check</span>
                  {paidCount}/{slotsCount} {lang === "fr" ? "payé" : "paid"}
                </span>
              )}
            </div>
            <p className="font-label-sm text-xs text-on-surface-variant mt-0.5">
              {isOpen
                ? lang === "fr"
                  ? "Cliquez pour refermer"
                  : "Click to close"
                : lang === "fr"
                ? "Cliquez pour voir vos noms et cotiser"
                : "Click to view your slots and pay"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-on-surface-variant flex-shrink-0">
          <span className="font-label-sm text-xs hidden sm:inline">
            {isOpen ? (lang === "fr" ? "Fermer" : "Close") : (lang === "fr" ? "Ouvrir" : "Open")}
          </span>
          <span
            className={`material-symbols-outlined transition-transform duration-200 ${
              isOpen ? "rotate-180" : ""
            }`}
          >
            expand_more
          </span>
        </div>
      </button>

      {isOpen && (
        <div className="border-t border-surface-variant">
          {children}
        </div>
      )}
    </div>
  );
}
