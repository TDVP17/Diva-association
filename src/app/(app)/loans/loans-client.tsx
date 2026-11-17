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
  requiresAdminApproval?: boolean;
  rejectionReason?: string | null;
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

  const allowedAmounts = eligibility.allowedAmounts;
  const [selectedAmount, setSelectedAmount] = useState<number>(
    allowedAmounts.length > 0 ? allowedAmounts[allowedAmounts.length - 1] : 0,
  );
  const [submitting, setSubmitting] = useState(false);
  const [repayingId, setRepayingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const pendingLoan = loans.find((l) => l.status === "PENDING_ADMIN") || null;
  const activeLoan = loans.find((l) => l.status === "ACTIVE" || l.status === "OVERDUE") || null;

  const effectiveAmount = allowedAmounts.includes(selectedAmount)
    ? selectedAmount
    : (allowedAmounts[allowedAmounts.length - 1] ?? 0);

  const requiresAdmin = effectiveAmount > eligibility.autoApprovalLimit;
  const simulatedInterest = Math.round(effectiveAmount * 0.15);
  const simulatedTotal = effectiveAmount + simulatedInterest;
  const simulatedDueDate = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000);

  async function refreshAll() {
    const res = await fetch("/api/loans");
    if (res.ok) {
      const data = await res.json();
      setEligibility(data.eligibility);
      setLoans(data.loans || []);
      setWalletBalance(data.walletBalance ?? walletBalance);
      const nextAllowed: number[] = data.eligibility?.allowedAmounts ?? [];
      setSelectedAmount(nextAllowed.length > 0 ? nextAllowed[nextAllowed.length - 1] : 0);
    }
  }

  async function handleRequestLoan(e: React.FormEvent) {
    e.preventDefault();
    if (!effectiveAmount) return;
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/loans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: effectiveAmount }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Impossible d'enregistrer votre demande de prêt.");
        return;
      }
      setSuccess(data.message || "Demande enregistrée avec succès !");
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
    <main className="px-container-padding py-stack-gap-lg max-w-3xl mx-auto w-full flex flex-col gap-5 pb-24">
      {/* Header + Stars Badge */}
      <div className="bg-gradient-to-br from-[#0b3d2e] to-[#0f513c] rounded-3xl p-5 sm:p-6 text-white shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-400/20 border border-amber-300/30 text-amber-200 text-[11px] font-bold">
            <span className="material-symbols-outlined text-[15px]">workspace_premium</span>
            <span>{lang === "fr" ? "Caisse de Secours 4 Étoiles" : "4-Star Emergency Credit"}</span>
          </span>
          <h1 className="text-xl sm:text-2xl font-extrabold mt-2 tracking-tight">
            {lang === "fr" ? "Prêts d'Urgence Garantis" : "Guaranteed Emergency Loans"}
          </h1>
          <p className="text-xs text-emerald-100/85 mt-1 max-w-md">
            Plafond calculé automatiquement selon vos cotisations réelles · 21 jours · 15 % d&apos;intérêts.
          </p>
        </div>

        <div className="bg-white/10 border border-white/15 rounded-2xl p-3.5 flex flex-col items-center min-w-[135px]">
          <span className="text-[10px] font-bold uppercase text-emerald-200">Votre Score</span>
          <div className="flex items-center gap-0.5 mt-1">
            {[1, 2, 3, 4, 5].map((i) => (
              <span
                key={i}
                className={`material-symbols-outlined text-[20px] ${
                  i <= eligibility.stars ? "text-amber-400" : "text-white/25"
                }`}
              >
                star
              </span>
            ))}
          </div>
          <span className="text-xs font-extrabold mt-0.5">{eligibility.stars} / 5 étoiles</span>
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

      {/* Pending Admin Approval Card (> 140 000 FCFA) */}
      {pendingLoan && (
        <div className="rounded-3xl p-5 sm:p-6 border-2 border-amber-300 bg-amber-50/70 shadow-sm flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-amber-700 text-[22px]">hourglass_top</span>
            <span className="px-2.5 py-0.5 rounded-full bg-amber-200 text-amber-950 text-[10px] font-extrabold uppercase">
              En attente de validation Admin
            </span>
          </div>
          <h2 className="text-lg font-extrabold text-slate-900">
            Demande de prêt : {formatXAF(pendingLoan.principal)}
          </h2>
          <p className="text-xs text-amber-950 leading-relaxed">
            Comme le montant demandé dépasse <strong>{formatXAF(eligibility.autoApprovalLimit)}</strong>, votre demande est en cours de vérification par l&apos;administrateur DIVA Asso. <strong>Votre portefeuille sera crédité uniquement après sa validation.</strong>
          </p>
          <div className="grid grid-cols-3 gap-2 text-xs bg-white/80 rounded-2xl p-3 border border-amber-200/70">
            <div>
              <span className="text-slate-500 block">Capital demandé</span>
              <strong className="text-slate-900">{formatXAF(pendingLoan.principal)}</strong>
            </div>
            <div>
              <span className="text-slate-500 block">Intérêts (15%)</span>
              <strong className="text-slate-900">{formatXAF(pendingLoan.interestAmount)}</strong>
            </div>
            <div>
              <span className="text-slate-500 block">Total à rembourser</span>
              <strong className="text-emerald-900">{formatXAF(pendingLoan.totalDue)}</strong>
            </div>
          </div>
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

      {/* Eligibility & Exact System Calculation */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Conditions Checklist */}
        <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-xs flex flex-col gap-3">
          <h3 className="text-sm font-extrabold text-slate-900">
            Vérification d&apos;éligibilité
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
                <p className="font-bold text-slate-900">2. Cotisation publique active</p>
                <p className="text-slate-500">
                  {eligibility.unpaidOutSlotsCount} nom(s) non bouffé(s) · {eligibility.paidOutSlotsCount} nom(s) déjà bouffé(s)
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <span
                className={`material-symbols-outlined text-[20px] flex-shrink-0 ${
                  eligibility.hasUnpaidOutSlots && eligibility.collateral.netCollateral > 0
                    ? "text-emerald-600"
                    : "text-red-500"
                }`}
              >
                {eligibility.hasUnpaidOutSlots && eligibility.collateral.netCollateral > 0
                  ? "check_circle"
                  : "cancel"}
              </span>
              <div>
                <p className="font-bold text-slate-900">3. Solde net acquis positif</p>
                <p className="text-slate-500">
                  Le système vérifie vos cotisations déjà payées moins ce qu&apos;il reste à payer sur vos noms bouffés.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Exact System Calculation Card */}
        <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-xs flex flex-col gap-3">
          <h3 className="text-sm font-extrabold text-slate-900">
            Calcul automatique de votre plafond
          </h3>
          <div className="flex flex-col gap-2 text-xs">
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">Déjà cotisé (noms non bouffés) :</span>
              <span className="font-bold text-emerald-700 whitespace-nowrap">
                +{formatXAF(eligibility.collateral.guaranteedFutureGainG)}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">Reste à cotiser (noms déjà bouffés) :</span>
              <span className="font-bold text-red-600 whitespace-nowrap">
                -{formatXAF(eligibility.collateral.remainingDebtD)}
              </span>
            </div>
            <div className="flex justify-between gap-2 pt-1.5 border-t border-slate-100">
              <span className="text-slate-700 font-semibold">Solde net garanti :</span>
              <span className="font-bold text-slate-900 whitespace-nowrap">
                {formatXAF(eligibility.collateral.netCollateral)}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">Bonus confiance (si solde &gt; 0) :</span>
              <span className="font-bold text-slate-700 whitespace-nowrap">
                +{formatXAF(eligibility.collateral.bonusToleranceApplied)}
              </span>
            </div>
            <div className="flex justify-between gap-2 pt-2 border-t border-slate-200 text-sm">
              <span className="font-extrabold text-emerald-950">Maximum autorisé :</span>
              <span className="font-extrabold text-emerald-700 whitespace-nowrap">
                {formatXAF(eligibility.collateral.maxLoanAmount)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* System-Controlled Loan Selection (NO arbitrary user input!) */}
      {!activeLoan && !pendingLoan && (
        <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/80 shadow-sm flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-base font-extrabold text-slate-900">
              Montant autorisé par le système
            </h2>
            {eligibility.eligible && (
              <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-900 text-xs font-extrabold">
                Max : {formatXAF(eligibility.collateral.maxLoanAmount)}
              </span>
            )}
          </div>

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
                <p className="text-xs text-slate-600">
                  Choisissez l&apos;un des paliers calculés automatiquement selon votre garantie réelle :
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {allowedAmounts.map((amt) => {
                    const active = effectiveAmount === amt;
                    const isMax = amt === eligibility.collateral.maxLoanAmount;
                    return (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => setSelectedAmount(amt)}
                        className={`p-3 rounded-2xl border-2 text-center transition-all cursor-pointer flex flex-col items-center justify-center ${
                          active
                            ? "border-emerald-700 bg-emerald-50 text-emerald-950 shadow-xs"
                            : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                        }`}
                      >
                        <span className="text-sm font-extrabold">{formatXAF(amt)}</span>
                        {isMax && (
                          <span className="text-[10px] font-bold text-emerald-700 uppercase mt-0.5">
                            Maximum
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Threshold Notice: <= 140 000 Auto vs > 140 000 Admin Approval */}
              <div
                className={`p-3.5 rounded-2xl border text-xs flex items-start gap-2.5 ${
                  requiresAdmin
                    ? "bg-amber-50 border-amber-200 text-amber-950"
                    : "bg-emerald-50/70 border-emerald-200 text-emerald-950"
                }`}
              >
                <span className="material-symbols-outlined text-[20px] flex-shrink-0">
                  {requiresAdmin ? "admin_panel_settings" : "bolt"}
                </span>
                <div>
                  <p className="font-bold">
                    {requiresAdmin
                      ? `Validation administrateur requise (> ${formatXAF(eligibility.autoApprovalLimit)})`
                      : `Validation automatique (≤ ${formatXAF(eligibility.autoApprovalLimit)})`}
                  </p>
                  <p className="text-[11px] mt-0.5 opacity-90">
                    {requiresAdmin
                      ? "Les gros prêts passent obligatoirement par l'administrateur DIVA Asso. Votre portefeuille sera crédité uniquement après son approbation."
                      : "Votre plafond étant vérifié et ≤ 140 000 FCFA, le montant est crédité automatiquement dans votre Portefeuille DIVA."}
                  </p>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 flex flex-col gap-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-600">Montant du prêt :</span>
                  <strong className="text-emerald-800">{formatXAF(effectiveAmount)}</strong>
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
                  Échéance estimée :{" "}
                  <strong>
                    {simulatedDueDate.toLocaleDateString("fr-FR", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </strong>{" "}
                  · Période de grâce : 2 jours · Passé le 23ᵉ jour : +5 % du capital tous les 2 jours + prélèvement automatique sur votre prochain pot.
                </p>
              </div>

              <button
                type="submit"
                disabled={submitting || !effectiveAmount}
                className={`w-full py-3.5 rounded-xl text-white font-bold text-sm transition-all shadow-md cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2 active:scale-[0.98] ${
                  requiresAdmin
                    ? "bg-amber-600 hover:bg-amber-700"
                    : "bg-emerald-700 hover:bg-emerald-800"
                }`}
              >
                {submitting ? (
                  <>
                    <LoadingSpinner />
                    <span>Traitement...</span>
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[20px]">
                      {requiresAdmin ? "send" : "bolt"}
                    </span>
                    <span>
                      {requiresAdmin
                        ? `Soumettre la demande de ${formatXAF(effectiveAmount)} à l'Admin`
                        : `Recevoir ${formatXAF(effectiveAmount)} dans mon Portefeuille`}
                    </span>
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
                    Demandé le {new Date(l.createdAt).toLocaleDateString("fr-FR")}
                    {l.rejectionReason ? ` · ${l.rejectionReason}` : ""}
                  </p>
                </div>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase whitespace-nowrap ${
                    l.status === "REPAID" || l.status === "DEDUCTED_FROM_POT"
                      ? "bg-emerald-100 text-emerald-800"
                      : l.status === "PENDING_ADMIN"
                        ? "bg-amber-100 text-amber-900"
                        : l.status === "REJECTED"
                          ? "bg-slate-100 text-slate-600"
                          : l.status === "OVERDUE"
                            ? "bg-red-100 text-red-700"
                            : "bg-blue-100 text-blue-800"
                  }`}
                >
                  {l.status === "PENDING_ADMIN"
                    ? "En attente Admin"
                    : l.status === "REJECTED"
                      ? "Refusé / Annulé"
                      : l.status === "REPAID"
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
