"use client";

import { useState } from "react";
import Link from "next/link";
import { formatXAF } from "@/lib/format-currency";
import { LoadingSpinner } from "@/components/loading-spinner";
import type { LoanEligibilityReport } from "@/lib/loans";
import type { Lang } from "@/lib/i18n/translations";

export interface LoanItem {
  id: string;
  principal: number;
  interestRate: number;
  interestAmount: number;
  penaltyAmount: number;
  totalDue: number;
  totalPaid: number;
  remainingDue: number;
  status: string;
  dueDate: string;
  graceEndDate: string;
  repaidAt: string | null;
  createdAt: string;
  guaranteeSlotLabel: string | null;
}

export function LoansClient({
  lang,
  initialEligibility,
  initialLoans,
  initialWalletBalance,
}: {
  lang: Lang;
  initialEligibility: LoanEligibilityReport;
  initialLoans: LoanItem[];
  initialWalletBalance: number;
}) {
  const [eligibility, setEligibility] = useState<LoanEligibilityReport>(initialEligibility);
  const [loans, setLoans] = useState<LoanItem[]>(initialLoans);
  const [walletBalance, setWalletBalance] = useState(initialWalletBalance);

  const maxAllowed = eligibility.collateral.maxLoanAmount;
  const [requestAmount, setRequestAmount] = useState<number>(
    maxAllowed >= 10_000 ? Math.min(25_000, maxAllowed) : Math.max(2_000, maxAllowed),
  );
  const [submitting, setSubmitting] = useState(false);
  const [repayingId, setRepayingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const activeLoan = loans.find((l) => l.status === "ACTIVE" || l.status === "OVERDUE") || null;

  const simulatedInterest = Math.round(requestAmount * 0.15);
  const simulatedTotal = requestAmount + simulatedInterest;
  const simulatedDueDate = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000);

  async function refreshAll() {
    const res = await fetch("/api/loans");
    if (res.ok) {
      const data = await res.json();
      setEligibility(data.eligibility);
      setLoans(data.loans || []);
      setWalletBalance(data.walletBalance ?? walletBalance);
    }
  }

  async function handleRequestLoan(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/loans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: requestAmount }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Impossible d'accorder le prêt.");
        return;
      }
      setSuccess(data.message || "Prêt versé dans votre Portefeuille DIVA !");
      await refreshAll();
    } catch {
      setError("Erreur réseau lors de la demande de prêt.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRepay(loan: LoanItem) {
    setError(null);
    setSuccess(null);
    setRepayingId(loan.id);
    try {
      const res = await fetch(`/api/loans/${loan.id}/repay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erreur lors du remboursement.");
        return;
      }
      setSuccess(data.message || "Prêt remboursé avec succès !");
      await refreshAll();
    } catch {
      setError("Erreur réseau lors du remboursement.");
    } finally {
      setRepayingId(null);
    }
  }

  return (
    <main className="px-container-padding py-stack-gap-lg max-w-3xl mx-auto w-full flex flex-col gap-6 pb-24">
      {/* Header + Stars Badge */}
      <div className="bg-gradient-to-br from-[#0b3d2e] to-[#0f513c] rounded-3xl p-6 text-white shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-400/20 border border-amber-300/30 text-amber-200 text-[11px] font-bold">
            <span className="material-symbols-outlined text-[15px]">workspace_premium</span>
            <span>{lang === "fr" ? "Caisse de Secours 4 Étoiles" : "4-Star Emergency Credit"}</span>
          </span>
          <h1 className="text-2xl font-extrabold mt-2 tracking-tight">
            {lang === "fr" ? "Prêts d'Urgence Garantis" : "Guaranteed Emergency Loans"}
          </h1>
          <p className="text-xs text-emerald-100/85 mt-1 max-w-md">
            Durée 21 jours · 15 % d&apos;intérêts · Crédité instantanément dans votre Portefeuille DIVA Asso.
          </p>
        </div>

        <div className="bg-white/10 border border-white/15 rounded-2xl p-4 flex flex-col items-center min-w-[140px]">
          <span className="text-[10px] font-bold uppercase text-emerald-200">Votre Score Confiance</span>
          <div className="flex items-center gap-0.5 mt-1">
            {[1, 2, 3, 4, 5].map((i) => (
              <span
                key={i}
                className={`material-symbols-outlined text-[22px] ${
                  i <= eligibility.stars ? "text-amber-400" : "text-white/25"
                }`}
              >
                star
              </span>
            ))}
          </div>
          <span className="text-xs font-extrabold mt-1">{eligibility.stars} / 5 étoiles</span>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 font-semibold">
          {error}
        </div>
      )}
      {success && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 font-semibold flex items-center gap-2">
          <span className="material-symbols-outlined text-emerald-700 text-[18px]">check_circle</span>
          <span>{success}</span>
        </div>
      )}

      {/* Active Loan Countdown Card */}
      {activeLoan && (() => {
        const nowMs = Date.now();
        const dueMs = new Date(activeLoan.dueDate).getTime();
        const graceMs = new Date(activeLoan.graceEndDate).getTime();
        const daysLeft = Math.ceil((dueMs - nowMs) / (24 * 60 * 60 * 1000));
        const inGrace = nowMs > dueMs && nowMs <= graceMs;
        const isOverdue = activeLoan.status === "OVERDUE" || nowMs > graceMs;

        return (
          <div
            className={`rounded-3xl p-5 sm:p-6 border-2 shadow-sm flex flex-col gap-4 ${
              isOverdue
                ? "bg-red-50/70 border-red-300"
                : inGrace
                  ? "bg-amber-50/70 border-amber-300"
                  : "bg-white border-emerald-600/30"
            }`}
          >
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                    isOverdue
                      ? "bg-red-600 text-white"
                      : inGrace
                        ? "bg-amber-500 text-white"
                        : "bg-emerald-100 text-emerald-900"
                  }`}
                >
                  {isOverdue
                    ? "En retard (+5% / 2 jours)"
                    : inGrace
                      ? "Période de grâce (48h)"
                      : `Prêt actif · ${Math.max(0, daysLeft)} jour(s) restant(s)`}
                </span>
                <h2 className="text-lg font-extrabold text-slate-900 mt-1.5">
                  Reste à rembourser : {formatXAF(activeLoan.remainingDue)}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Échéance :{" "}
                  <strong>
                    {new Date(activeLoan.dueDate).toLocaleDateString("fr-FR", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </strong>
                  {activeLoan.guaranteeSlotLabel ? ` · Garantie : ${activeLoan.guaranteeSlotLabel}` : ""}
                </p>
              </div>
              <div className="text-right text-xs">
                <p className="text-slate-500">Solde Portefeuille</p>
                <p className="font-extrabold text-emerald-900 text-sm">{formatXAF(walletBalance)}</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs bg-white/80 rounded-2xl p-3 border border-slate-200/70">
              <div>
                <span className="text-slate-500 block">Capital</span>
                <strong className="text-slate-900">{formatXAF(activeLoan.principal)}</strong>
              </div>
              <div>
                <span className="text-slate-500 block">Intérêts (15%)</span>
                <strong className="text-slate-900">{formatXAF(activeLoan.interestAmount)}</strong>
              </div>
              <div>
                <span className="text-slate-500 block">Pénalités retard</span>
                <strong className={activeLoan.penaltyAmount > 0 ? "text-red-600" : "text-slate-900"}>
                  {formatXAF(activeLoan.penaltyAmount)}
                </strong>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              {walletBalance >= activeLoan.remainingDue ? (
                <button
                  type="button"
                  disabled={repayingId === activeLoan.id}
                  onClick={() => handleRepay(activeLoan)}
                  className="flex-1 py-3 px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2 shadow-xs"
                >
                  {repayingId === activeLoan.id ? (
                    <LoadingSpinner />
                  ) : (
                    <span className="material-symbols-outlined text-[18px]">check_circle</span>
                  )}
                  <span>
                    Rembourser intégralement ({formatXAF(activeLoan.remainingDue)}) via mon Portefeuille
                  </span>
                </button>
              ) : (
                <Link
                  href="/wallet"
                  className="flex-1 py-3 px-4 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs text-center"
                >
                  Recharger mon portefeuille pour rembourser ({formatXAF(activeLoan.remainingDue)})
                </Link>
              )}
            </div>

            <p className="text-[11px] text-slate-500">
              Garantie automatique : si le prêt n&apos;est pas remboursé avant votre prochain tour de bouffe, le montant total (capital + 15 % + pénalités) sera prélevé automatiquement à la source sur votre cagnotte.
            </p>
          </div>
        );
      })()}

      {/* 3 Cumulative Eligibility Conditions & Mathematical Collateral Formula */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Conditions Checklist */}
        <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-xs flex flex-col gap-3">
          <h3 className="text-sm font-extrabold text-slate-900">
            Conditions d&apos;éligibilité (3 règles)
          </h3>

          <div className="flex flex-col gap-2.5 text-xs">
            <div className="flex items-start gap-2.5">
              <span
                className={`material-symbols-outlined text-[20px] flex-shrink-0 ${
                  eligibility.hasFourStars && eligibility.hasNoActiveFines
                    ? "text-emerald-600"
                    : "text-red-500"
                }`}
              >
                {eligibility.hasFourStars && eligibility.hasNoActiveFines ? "check_circle" : "cancel"}
              </span>
              <div>
                <p className="font-bold text-slate-900">1. Badge 4 Étoiles & Zéro amende active</p>
                <p className="text-slate-500">
                  {eligibility.stars}/5 étoiles · {eligibility.unpaidFinesCount} amende(s) impayée(s)
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <span
                className={`material-symbols-outlined text-[20px] flex-shrink-0 ${
                  eligibility.hasActivePublicParticipation ? "text-emerald-600" : "text-red-500"
                }`}
              >
                {eligibility.hasActivePublicParticipation ? "check_circle" : "cancel"}
              </span>
              <div>
                <p className="font-bold text-slate-900">2. Membre actif en cotisation publique</p>
                <p className="text-slate-500">
                  Réservé aux cotisations publiques DIVA Asso (privées exclues).
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <span
                className={`material-symbols-outlined text-[20px] flex-shrink-0 ${
                  eligibility.hasUnpaidOutSlots ? "text-emerald-600" : "text-red-500"
                }`}
              >
                {eligibility.hasUnpaidOutSlots ? "check_circle" : "cancel"}
              </span>
              <div>
                <p className="font-bold text-slate-900">3. Collatéral résiduel disponible</p>
                <p className="text-slate-500">
                  Au moins un nom non encore bouffé dans le cycle actif.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Collateral Math Breakdown */}
        <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-xs flex flex-col gap-3">
          <h3 className="text-sm font-extrabold text-slate-900">
            Calcul mathématique de votre plafond
          </h3>
          <div className="flex flex-col gap-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">Gain futur garanti (G) :</span>
              <span className="font-bold text-emerald-700">
                +{formatXAF(eligibility.collateral.guaranteedFutureGainG)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Dette restante noms bouffés (D) :</span>
              <span className="font-bold text-red-600">
                -{formatXAF(eligibility.collateral.remainingDebtD)}
              </span>
            </div>
            <div className="flex justify-between pt-1.5 border-t border-slate-100">
              <span className="text-slate-700 font-semibold">Collatéral Net (G − D) :</span>
              <span className="font-bold text-slate-900">
                {formatXAF(eligibility.collateral.netCollateral)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Tolérance risque 4 étoiles :</span>
              <span className="font-bold text-slate-700">
                {eligibility.hasUnpaidOutSlots ? "+10 000 FCFA" : "0 FCFA"}
              </span>
            </div>
            <div className="flex justify-between pt-2 border-t border-slate-200 text-sm">
              <span className="font-extrabold text-emerald-950">Plafond Maximal :</span>
              <span className="font-extrabold text-emerald-700">
                {formatXAF(eligibility.collateral.maxLoanAmount)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Loan Simulator & Instant Request Form */}
      {!activeLoan && (
        <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/80 shadow-sm flex flex-col gap-4">
          <h2 className="text-base font-extrabold text-slate-900">
            Demander un Prêt d&apos;Urgence
          </h2>

          {!eligibility.eligible ? (
            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-950 flex flex-col gap-2">
              <p className="font-bold flex items-center gap-1.5">
                <span className="material-symbols-outlined text-amber-700 text-[18px]">lock</span>
                Non éligible pour le moment :
              </p>
              <ul className="list-disc pl-5 flex flex-col gap-1">
                {eligibility.reasons.map((r, idx) => (
                  <li key={idx}>{r}</li>
                ))}
              </ul>
            </div>
          ) : (
            <form onSubmit={handleRequestLoan} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-center text-xs">
                  <label className="font-bold text-slate-700">Montant souhaité :</label>
                  <span className="font-extrabold text-base text-emerald-800">
                    {formatXAF(requestAmount)}
                  </span>
                </div>
                <input
                  type="range"
                  min={2000}
                  max={maxAllowed}
                  step={500}
                  value={Math.min(requestAmount, maxAllowed)}
                  onChange={(e) => setRequestAmount(Number(e.target.value))}
                  className="w-full accent-emerald-700 cursor-pointer"
                />
                <input
                  type="number"
                  min={2000}
                  max={maxAllowed}
                  step={500}
                  value={requestAmount}
                  onChange={(e) =>
                    setRequestAmount(Math.min(maxAllowed, Math.max(0, Number(e.target.value) || 0)))
                  }
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-bold text-slate-900"
                />
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 flex flex-col gap-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-600">Crédité instantanément dans votre Portefeuille :</span>
                  <strong className="text-emerald-800">{formatXAF(requestAmount)}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Intérêts contractuels (15 %) :</span>
                  <strong className="text-slate-900">+{formatXAF(simulatedInterest)}</strong>
                </div>
                <div className="flex justify-between pt-1.5 border-t border-slate-200 text-sm">
                  <span className="font-extrabold text-slate-900">Total à rembourser (sous 21 jours) :</span>
                  <strong className="font-extrabold text-emerald-900">{formatXAF(simulatedTotal)}</strong>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Échéance :{" "}
                  <strong>
                    {simulatedDueDate.toLocaleDateString("fr-FR", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </strong>{" "}
                  · Période de grâce : 2 jours · Passé le 23ᵉ jour : +5 % du capital tous les 2 jours + prélèvement automatique sur votre prochain pot de bouffe.
                </p>
              </div>

              <button
                type="submit"
                disabled={submitting || requestAmount < 2000 || requestAmount > maxAllowed}
                className="w-full py-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 active:scale-[0.98] text-white font-bold text-sm transition-all shadow-md cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <LoadingSpinner />
                    <span>Décaissement instantané...</span>
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[20px]">bolt</span>
                    <span>Recevoir {formatXAF(requestAmount)} dans mon Portefeuille</span>
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      )}

      {/* Loan History */}
      {loans.length > 0 && (
        <div className="bg-white rounded-3xl p-5 border border-slate-200/80 flex flex-col gap-3">
          <h3 className="text-sm font-extrabold text-slate-900">Historique de mes prêts</h3>
          <div className="flex flex-col divide-y divide-slate-100">
            {loans.map((l) => (
              <div key={l.id} className="py-3 flex items-center justify-between gap-2 text-xs">
                <div>
                  <p className="font-bold text-slate-900">
                    Prêt de {formatXAF(l.principal)} (Total dû : {formatXAF(l.totalDue)})
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Accordé le {new Date(l.createdAt).toLocaleDateString("fr-FR")} · Échéance :{" "}
                    {new Date(l.dueDate).toLocaleDateString("fr-FR")}
                  </p>
                </div>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                    l.status === "REPAID" || l.status === "DEDUCTED_FROM_POT"
                      ? "bg-emerald-100 text-emerald-800"
                      : l.status === "OVERDUE"
                        ? "bg-red-100 text-red-700"
                        : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {l.status === "REPAID"
                    ? "Remboursé"
                    : l.status === "DEDUCTED_FROM_POT"
                      ? "Prélevé sur pot"
                      : l.status === "OVERDUE"
                        ? "En retard"
                        : "Actif"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}

