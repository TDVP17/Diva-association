"use client";

import { useState } from "react";
import type { Lang } from "@/lib/i18n/translations";

interface FeesInfoAccordionProps {
  lang: Lang;
  contributionAmount?: number;
  serviceFee?: number;
}

export function FeesInfoAccordion({
  lang,
}: FeesInfoAccordionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const isFr = lang === "fr";

  return (
    <div className="mb-stack-gap-lg bg-surface rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-4 flex items-center justify-between hover:bg-surface-container-low transition-colors cursor-pointer text-left"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-700 flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-[22px]">account_balance_wallet</span>
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-title-sm text-title-sm text-on-surface font-bold">
                {isFr ? "Comment fonctionnent les frais ?" : "How Do Fees Work?"}
              </h2>
              <span className="font-label-sm text-xs px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200/80 font-semibold">
                {isFr ? "Cotisations publiques" : "Public Cotisations"}
              </span>
            </div>
            <p className="font-label-sm text-xs text-on-surface-variant mt-0.5">
              {isOpen
                ? isFr
                  ? "Cliquez pour refermer les explications"
                  : "Click to close explanations"
                : isFr
                ? "Cliquez pour voir les détails"
                : "Click to view details"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-on-surface-variant flex-shrink-0">
          <span className="font-label-sm text-xs hidden sm:inline">
            {isOpen ? (isFr ? "Fermer" : "Close") : (isFr ? "Ouvrir" : "Open")}
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
        <div className="border-t border-surface-variant p-4 sm:p-5 bg-surface-container-low/30 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* 1. Frais de paiement Orange / MTN */}
            <div className="p-3.5 bg-white rounded-xl border border-surface-variant flex flex-col justify-between">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-[18px]">phone_android</span>
                </div>
                <div>
                  <h3 className="font-semibold text-on-surface text-xs sm:text-sm">
                    {isFr ? "Frais de paiement" : "Payment Fees"}
                  </h3>
                  <span className="text-[11px] font-bold text-primary">3,1 % (Orange / MTN)</span>
                </div>
              </div>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                {isFr
                  ? "Les frais de paiement chez Orange ou MTN sont de 3,1% sur le montant total à cotiser (uniquement pour les cotisations publiques)."
                  : "Payment fees on Orange or MTN are 3.1% on the total amount to contribute (public cotisations only)."}
              </p>
            </div>

            {/* 2. Gain du tour (+25% des frais) */}
            <div className="p-3.5 bg-white rounded-xl border border-surface-variant flex flex-col justify-between">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-700 flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-[18px]">emoji_events</span>
                </div>
                <div>
                  <h3 className="font-semibold text-on-surface text-xs sm:text-sm">
                    {isFr ? "À la bouffe" : "When Eating the Pot"}
                  </h3>
                  <span className="text-[11px] font-bold text-emerald-700">
                    {isFr ? "+ 25 % des frais" : "+ 25% of Fees"}
                  </span>
                </div>
              </div>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                {isFr
                  ? "Lorsqu'il bouffe, il bouffe le montant à cotiser + 25% des frais."
                  : "When eating the pot, the member receives the contribution amount + 25% of fees."}
              </p>
            </div>

            {/* 3. Amendes de retard (50% reversés) */}
            <div className="p-3.5 bg-white rounded-xl border border-surface-variant flex flex-col justify-between">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-700 flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-[18px]">gavel</span>
                </div>
                <div>
                  <h3 className="font-semibold text-on-surface text-xs sm:text-sm">
                    {isFr ? "En cas de retard" : "Late Fines"}
                  </h3>
                  <span className="text-[11px] font-bold text-amber-700">
                    {isFr ? "50 % des amendes" : "50% of Fines"}
                  </span>
                </div>
              </div>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                {isFr
                  ? "Pour les amendes en cas de retard : 50% de chaque personne qui a cotisé en retard est ajouté sur son compte uniquement lorsqu'il bouffe."
                  : "For late fines: 50% of each late contributor's fine is added to their account only when they eat the pot."}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
