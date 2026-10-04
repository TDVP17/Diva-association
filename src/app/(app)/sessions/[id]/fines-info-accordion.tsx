"use client";

import { useState } from "react";
import type { Lang } from "@/lib/i18n/translations";
import { formatXAF } from "@/lib/format-currency";

interface FinesInfoAccordionProps {
  lang: Lang;
  fineAmount: number;
  fineIntervalHours: number;
  limitTime: string;
}

export function FinesInfoAccordion({
  lang,
  fineAmount,
  fineIntervalHours,
  limitTime,
}: FinesInfoAccordionProps) {
  // Fermé par défaut selon la demande : c'est si l'utilisateur veut qu'il ouvre
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
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-700 flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-[22px]">gavel</span>
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-title-sm text-title-sm text-on-surface font-bold">
                {isFr ? "Comment fonctionnent les amendes ?" : "How Do Late Fines Work?"}
              </h2>
              <span className="font-label-sm text-xs px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200/80 font-semibold">
                {formatXAF(fineAmount)} / {fineIntervalHours}h
              </span>
            </div>
            <p className="font-label-sm text-xs text-on-surface-variant mt-0.5">
              {isOpen
                ? isFr
                  ? "Cliquez pour refermer les explications"
                  : "Click to close explanations"
                : isFr
                ? "Cliquez pour voir le montant et après combien d'heures l'amende s'applique"
                : "Click to view amount and after how many hours fines apply"}
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
        <div className="border-t border-surface-variant p-4 sm:p-5 bg-surface-container-low/30 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* 1. Heure limite */}
            <div className="p-3.5 bg-white rounded-xl border border-surface-variant flex gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="material-symbols-outlined text-[20px]">schedule</span>
              </div>
              <div className="text-xs">
                <p className="font-semibold text-on-surface text-sm">
                  {isFr ? "Heure limite de paiement" : "Payment Deadline"}
                </p>
                <p className="text-primary font-bold mt-0.5 text-sm">
                  {limitTime} {isFr ? "(Heure du Cameroun)" : "(Cameroon Time)"}
                </p>
                <p className="text-on-surface-variant mt-1 leading-relaxed">
                  {isFr
                    ? `Les contributions doivent être versées avant ${limitTime}. Dès cette heure dépassée, le cycle est considéré en retard.`
                    : `Contributions must be submitted before ${limitTime}. Once this time passes, contributions are considered late.`}
                </p>
              </div>
            </div>

            {/* 2. Montant de l'amende */}
            <div className="p-3.5 bg-white rounded-xl border border-surface-variant flex gap-3">
              <div className="w-9 h-9 rounded-lg bg-amber-500/10 text-amber-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="material-symbols-outlined text-[20px]">payments</span>
              </div>
              <div className="text-xs">
                <p className="font-semibold text-on-surface text-sm">
                  {isFr ? "Montant de l'amende" : "Fine Amount"}
                </p>
                <p className="text-amber-800 font-bold mt-0.5 text-sm">
                  {formatXAF(fineAmount)} {isFr ? "par nom" : "per slot"}
                </p>
                <p className="text-on-surface-variant mt-1 leading-relaxed">
                  {isFr
                    ? `Une pénalité forfaitaire de ${formatXAF(fineAmount)} est facturée pour chaque nom en retard de paiement.`
                    : `A fixed penalty of ${formatXAF(fineAmount)} is charged for each unpaid registered slot.`}
                </p>
              </div>
            </div>

            {/* 3. Après combien d'heures */}
            <div className="p-3.5 bg-white rounded-xl border border-surface-variant flex gap-3">
              <div className="w-9 h-9 rounded-lg bg-rose-500/10 text-rose-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="material-symbols-outlined text-[20px]">update</span>
              </div>
              <div className="text-xs">
                <p className="font-semibold text-on-surface text-sm">
                  {isFr ? "Après combien d'heures ?" : "When & How Often?"}
                </p>
                <p className="text-rose-700 font-bold mt-0.5 text-sm">
                  {isFr ? `Toutes les ${fineIntervalHours} heures` : `Every ${fineIntervalHours} hours`}
                </p>
                <p className="text-on-surface-variant mt-1 leading-relaxed">
                  {isFr
                    ? `La première amende s'applique dès l'échéance (${limitTime}). Ensuite, si le paiement n'est toujours pas fait, ${formatXAF(fineAmount)} s'ajoutent toutes les ${fineIntervalHours}h de retard supplémentaire.`
                    : `The initial fine applies right at the deadline (${limitTime}). Then, if still unpaid, an additional ${formatXAF(fineAmount)} is added every ${fineIntervalHours} hours of further delay.`}
                </p>
              </div>
            </div>

            {/* 4. Règlement & Déduction */}
            <div className="p-3.5 bg-white rounded-xl border border-surface-variant flex gap-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="material-symbols-outlined text-[20px]">account_balance_wallet</span>
              </div>
              <div className="text-xs">
                <p className="font-semibold text-on-surface text-sm">
                  {isFr ? "Règlement des amendes" : "Fine Settlement"}
                </p>
                <p className="text-emerald-700 font-bold mt-0.5 text-sm">
                  {isFr ? "Non obligatoire sur-le-champ" : "Not required on the spot"}
                </p>
                <p className="text-on-surface-variant mt-1 leading-relaxed">
                  {isFr
                    ? "Les amendes ne sont pas obligées d'être payées à l'instant : vous pouvez cotiser seul. Vos amendes peuvent être réglées à tout moment ou déduites de votre cagnotte lors de votre versement. Attention : à la fin de la cotisation, si vous avez des amendes impayées, vous ne pourrez pas intégrer une autre cotisation sans avoir tout régularisé."
                    : "Fines do not have to be paid immediately: you can pay your contribution alone. Fines can be settled anytime or will be deducted from your pot on your payout round. Note: At the end of the cotisation, if you have outstanding fines, you cannot join another cotisation without settling them."}
                </p>
              </div>
            </div>
          </div>

          {/* Exemple concret */}
          <div className="bg-white rounded-xl p-3.5 border border-surface-variant text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-on-surface mb-2 text-xs">
              <span className="material-symbols-outlined text-amber-600 text-[18px]">lightbulb</span>
              {isFr ? "Exemple concret de calcul du retard :" : "Practical Late Calculation Example:"}
            </div>
            <ul className="space-y-1.5 text-on-surface-variant text-xs">
              <li className="flex items-start gap-2">
                <span className="material-symbols-outlined text-emerald-600 text-[16px] mt-0.5">check_circle</span>
                <span>
                  <strong>{isFr ? `Avant ${limitTime}` : `Before ${limitTime}`} :</strong>{" "}
                  {isFr ? "Cotisation à jour, 0 F d'amende." : "Contribution up to date, 0 F fine."}
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="material-symbols-outlined text-amber-600 text-[16px] mt-0.5">schedule</span>
                <span>
                  <strong>{isFr ? `Dès ${limitTime} dépassé` : `Past ${limitTime}`} :</strong>{" "}
                  {isFr
                    ? `1ère amende immédiate de ${formatXAF(fineAmount)}.`
                    : `1st immediate fine of ${formatXAF(fineAmount)}.`}
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="material-symbols-outlined text-rose-600 text-[16px] mt-0.5">warning</span>
                <span>
                  <strong>{isFr ? `Après ${fineIntervalHours}h de retard` : `After ${fineIntervalHours}h late`} :</strong>{" "}
                  {isFr
                    ? `Nouvelle amende de ${formatXAF(fineAmount)} (soit ${formatXAF(fineAmount * 2)} au total), et ainsi de suite.`
                    : `Additional fine of ${formatXAF(fineAmount)} (total ${formatXAF(fineAmount * 2)}), recurring every ${fineIntervalHours}h.`}
                </span>
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
