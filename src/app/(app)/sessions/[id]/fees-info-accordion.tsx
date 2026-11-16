"use client";

import { useState } from "react";
import type { Lang } from "@/lib/i18n/translations";
import { formatXAF } from "@/lib/format-currency";

interface FeesInfoAccordionProps {
  lang: Lang;
  contributionAmount: number;
  serviceFee: number;
}

export function FeesInfoAccordion({
  lang,
  contributionAmount,
  serviceFee,
}: FeesInfoAccordionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const isFr = lang === "fr";

  const totalPerSlot = contributionAmount + serviceFee;
  const operatorFeeApprox = Math.round(totalPerSlot * 0.031);
  const feeBonusPerSlot = Math.round(serviceFee * 0.25);

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
                ? "Frais opérateur 3,1%, bonus de 25% des frais à la bouffe & partage des amendes"
                : "3.1% operator fee, +25% fee bonus when eating & late fines sharing"}
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
          <div className="p-2.5 rounded-lg bg-emerald-50/70 border border-emerald-200/60 text-xs text-emerald-900 flex items-center gap-2">
            <span className="material-symbols-outlined text-emerald-700 text-[18px] flex-shrink-0">info</span>
            <span>
              {isFr
                ? "Ces règles tarifaires et de redistribution s'appliquent exclusivement aux cotisations publiques."
                : "These pricing and redistribution rules apply strictly to public cotisations."}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* 1. Frais de paiement Orange / MTN */}
            <div className="p-3.5 bg-white rounded-xl border border-surface-variant flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                    <span className="material-symbols-outlined text-[18px]">phone_android</span>
                  </div>
                  <div>
                    <h3 className="font-semibold text-on-surface text-xs sm:text-sm">
                      {isFr ? "Frais de paiement opérateur" : "Mobile Money Operator Fees"}
                    </h3>
                    <span className="text-[11px] font-bold text-primary">3,1 % (Orange / MTN)</span>
                  </div>
                </div>
                <p className="text-xs text-on-surface-variant leading-relaxed">
                  {isFr
                    ? "Les frais de paiement chez Orange Money ou MTN Mobile Money sont de 3,1% appliqués sur le montant total à cotiser (uniquement pour les cotisations publiques)."
                    : "Payment processing fees for Orange Money or MTN Mobile Money are 3.1% applied to the total contribution amount (public cotisations only)."}
                </p>
              </div>
              <div className="mt-3 pt-2.5 border-t border-surface-variant text-[11px] text-on-surface-variant bg-surface-container-low/50 -mx-3.5 -mb-3.5 p-2.5 rounded-b-xl">
                <span className="font-medium text-on-surface">
                  {isFr ? "Exemple par part :" : "Per-slot example:"}
                </span>{" "}
                {formatXAF(totalPerSlot)} + ~{formatXAF(operatorFeeApprox)} {isFr ? "de frais opérateur" : "operator fee"}
              </div>
            </div>

            {/* 2. Gain du tour (+25% des frais) */}
            <div className="p-3.5 bg-white rounded-xl border border-surface-variant flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-700 flex items-center justify-center flex-shrink-0">
                    <span className="material-symbols-outlined text-[18px]">emoji_events</span>
                  </div>
                  <div>
                    <h3 className="font-semibold text-on-surface text-xs sm:text-sm">
                      {isFr ? "Gain du tour (À la bouffe)" : "Payout (Eating the Pot)"}
                    </h3>
                    <span className="text-[11px] font-bold text-emerald-700">
                      {isFr ? "Cotisation + 25 % des frais" : "Contribution + 25% of Fees"}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-on-surface-variant leading-relaxed">
                  {isFr
                    ? "Lorsqu'un membre bouffe son tour, il perçoit l'intégralité du montant cotisé par les participants + 25% des frais d'association reversés en bonus sur son gain."
                    : "When a member eats their round, they receive the full contributed amount + 25% of association management fees credited as a bonus."}
                </p>
              </div>
              <div className="mt-3 pt-2.5 border-t border-surface-variant text-[11px] text-emerald-800 bg-emerald-50/50 -mx-3.5 -mb-3.5 p-2.5 rounded-b-xl">
                <span className="font-medium">
                  {isFr ? "Bonus par part cotisée :" : "Bonus per slot:"}
                </span>{" "}
                +{formatXAF(feeBonusPerSlot)} {isFr ? "(25% des frais)" : "(25% of fee)"}
              </div>
            </div>

            {/* 3. Amendes de retard (50% reversés) */}
            <div className="p-3.5 bg-white rounded-xl border border-surface-variant flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-700 flex items-center justify-center flex-shrink-0">
                    <span className="material-symbols-outlined text-[18px]">gavel</span>
                  </div>
                  <div>
                    <h3 className="font-semibold text-on-surface text-xs sm:text-sm">
                      {isFr ? "Partage des amendes" : "Late Fines Sharing"}
                    </h3>
                    <span className="text-[11px] font-bold text-amber-700">
                      {isFr ? "50 % pour le bénéficiaire" : "50% to Beneficiary"}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-on-surface-variant leading-relaxed">
                  {isFr
                    ? "En cas de retard d'un membre : le bénéficiaire qui attend son tour a droit à 50% du montant de l'amende payée par chaque retardataire. Ce montant est crédité sur son compte uniquement lorsqu'il bouffe."
                    : "If a member pays late: the beneficiary waiting for their payout receives 50% of the late fine paid by each latecomer. This amount is credited to their account only when they eat the pot."}
                </p>
              </div>
              <div className="mt-3 pt-2.5 border-t border-surface-variant text-[11px] text-amber-800 bg-amber-50/50 -mx-3.5 -mb-3.5 p-2.5 rounded-b-xl">
                <span className="font-medium">
                  {isFr ? "Crédité au moment de bouffer" : "Credited upon payout release"}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

