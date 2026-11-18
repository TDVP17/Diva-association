"use client";

import { useEffect, useState } from "react";
import { formatXAF } from "@/lib/format-currency";
import { LoadingSpinner } from "@/components/loading-spinner";
import { getOperatorInfo, detectMobileMoneyProvider } from "@/lib/mobile-money-provider";
import { OperatorBadge } from "@/components/operator-badge";
import type { LoanEligibilityReport } from "@/lib/loans";
import type { Lang } from "@/lib/i18n/translations";

export interface LoanItem {
  id: string;
  principal: number;
  interestRate: number;
  interestAmount: number;
  divaFeeAmount: number;
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

interface OperatorSuspension {
  isOrangeSuspended: boolean;
  orangeSuspendedReason: string;
  isMtnSuspended: boolean;
  mtnSuspendedReason: string;
}

function sanitizeDigits(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  return digits.replace(/^0+(?=\d)/, "");
}

function computeDueDateAt18hClient(): Date {
  const now = new Date();
  const cmrNow = new Date(now.getTime() + 60 * 60 * 1000);
  return new Date(
    Date.UTC(cmrNow.getUTCFullYear(), cmrNow.getUTCMonth(), cmrNow.getUTCDate() + 21, 17, 0, 0, 0),
  );
}

function formatDeadlineDate(d: Date): string {
  return d.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Africa/Douala",
  });
}

export function LoansClient({
  lang,
  initialEligibility,
  initialLoans,
  initialWalletBalance,
  userPhone,
  operatorSuspension,
}: {
  lang: Lang;
  initialEligibility: LoanEligibilityReport;
  initialLoans: LoanItem[];
  initialWalletBalance: number;
  userPhone: string;
  operatorSuspension: OperatorSuspension;
}) {
  const [eligibility, setEligibility] = useState<LoanEligibilityReport>(initialEligibility);
  const [loans, setLoans] = useState<LoanItem[]>(initialLoans);
  const [walletBalance, setWalletBalance] = useState(initialWalletBalance);

  // User types the amount themselves (emptyable string, no sticky 0, no preset buttons!)
  const maxAllowed = eligibility.collateral.maxLoanAmount;
  const [amountInput, setAmountInput] = useState<string>("");
  const typedAmount = parseInt(amountInput, 10) || 0;

  // Commitment confirmation modal
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Repayment state (wallet OR direct mobile money +3.1%)
  const [repayMode, setRepayMode] = useState<"WALLET" | "DIRECT">("WALLET");
  const [repayPhone, setRepayPhone] = useState(userPhone);
  const [repayingId, setRepayingId] = useState<string | null>(null);
  const [directPendingMsg, setDirectPendingMsg] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const pendingLoan = loans.find((l) => l.status === "PENDING_ADMIN") || null;
  const activeLoan = loans.find((l) => l.status === "ACTIVE" || l.status === "OVERDUE") || null;

  useEffect(() => {
    if (!activeLoan) return;
    const interval = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [activeLoan]);

  const simulatedInterest = Math.round(typedAmount * 0.15);
  const simulatedDivaFee = Math.round(typedAmount * 0.02);
  const simulatedTotal = typedAmount + simulatedInterest + simulatedDivaFee;
  const requiresAdmin = simulatedTotal > 50_000;
  const simulatedDueDate = computeDueDateAt18hClient();
  const simulatedDueDateLabel = formatDeadlineDate(simulatedDueDate);

  const isAmountValid = typedAmount >= 1_000 && typedAmount <= maxAllowed;

  // Direct repayment operator check
  const repayOperatorInfo = getOperatorInfo(repayPhone, lang);
  const repayProvider = detectMobileMoneyProvider(repayPhone.replace(/\D/g, "").replace(/^237/, ""));
  const isRepayOperatorSuspended =
    (repayProvider === "ORANGE" && operatorSuspension.isOrangeSuspended) ||
    (repayProvider === "MTN" && operatorSuspension.isMtnSuspended);
  const repaySuspendedReason =
    repayProvider === "ORANGE"
      ? operatorSuspension.orangeSuspendedReason || "Orange Money est temporairement suspendu."
      : operatorSuspension.mtnSuspendedReason || "MTN Mobile Money est temporairement suspendu.";

  async function refreshAll() {
    const res = await fetch("/api/loans");
    if (res.ok) {
      const data = await res.json();
      setEligibility(data.eligibility);
      setLoans(data.loans || []);
      setWalletBalance(data.walletBalance ?? walletBalance);
    }
  }

  function handleContinue(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!typedAmount || typedAmount < 1_000) {
      setError("Veuillez saisir un montant d'au moins 1 000 FCFA.");
      return;
    }
    if (typedAmount > maxAllowed) {
      setError(`Le montant saisi dépasse votre maximum autorisé (${formatXAF(maxAllowed)}).`);
      return;
    }
    setShowConfirmModal(true);
  }

  async function handleConfirmLoanSubmit() {
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/loans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: typedAmount }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Impossible d'enregistrer votre demande de prêt.");
        setShowConfirmModal(false);
        return;
      }
      setShowConfirmModal(false);
      setAmountInput("");
      setSuccess(data.message || "Demande enregistrée avec succès !");
      await refreshAll();
    } catch {
      setError("Erreur réseau lors de la demande de prêt.");
      setShowConfirmModal(false);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRepayWallet(loan: LoanItem) {
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

  async function handleRepayDirect(loan: LoanItem) {
    setError(null);
    setSuccess(null);
    setDirectPendingMsg(null);
    if (isRepayOperatorSuspended) {
      setError(repaySuspendedReason);
      return;
    }
    setRepayingId(loan.id);
    try {
      const res = await fetch(`/api/loans/${loan.id}/repay-direct`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: repayPhone.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Impossible d'initier le paiement direct.");
        return;
      }
      if (data.status === "SUCCESSFUL") {
        setSuccess(data.message || "Prêt remboursé avec succès !");
        await refreshAll();
        return;
      }
      setDirectPendingMsg(data.message || "Veuillez valider le débit sur votre téléphone...");
      // Poll payment status up to 45s
      const transId = data.transId;
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const pollRes = await fetch(
          `/api/loans/${loan.id}/repay-direct?transId=${encodeURIComponent(transId)}&phone=${encodeURIComponent(repayPhone.trim())}`,
        );
        if (pollRes.ok) {
          const pollData = await pollRes.json();
          if (pollData.status === "SUCCESSFUL") {
            setDirectPendingMsg(null);
            setSuccess("Prêt remboursé intégralement par paiement direct !");
            await refreshAll();
            return;
          }
          if (pollData.status === "FAILED" || pollData.status === "EXPIRED") {
            setDirectPendingMsg(null);
            setError("Le paiement direct n'a pas abouti ou a expiré. Veuillez réessayer.");
            return;
          }
        }
      }
      setDirectPendingMsg("En attente de confirmation opérateur. Rafraîchissez dans quelques instants.");
    } catch {
      setError("Erreur réseau lors du paiement direct.");
    } finally {
      setRepayingId(null);
    }
  }

  return (
    <main className="px-container-padding py-4 max-w-xl mx-auto w-full flex flex-col gap-4 pb-24">
      {/* Compact Header Card */}
      <div className="bg-gradient-to-br from-[#0b3d2e] to-[#0f513c] rounded-2xl px-4 py-3.5 text-white shadow-md flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-base sm:text-lg font-extrabold tracking-tight leading-tight">
            {lang === "fr" ? "Prêts d'Urgence Garantis" : "Guaranteed Emergency Loans"}
          </h1>
          <div className="flex items-center gap-0.5 mt-1">
            {[1, 2, 3, 4, 5].map((i) => (
              <span
                key={i}
                className={`material-symbols-outlined text-[16px] ${
                  i <= eligibility.stars ? "text-amber-400" : "text-white/25"
                }`}
              >
                star
              </span>
            ))}
            <span className="text-[11px] font-bold text-emerald-100 ml-1">
              {eligibility.stars}/5
            </span>
          </div>
        </div>
        {eligibility.eligible && maxAllowed > 0 && (
          <div className="bg-white/10 border border-white/15 rounded-xl px-3 py-1.5 text-right flex-shrink-0">
            <span className="text-[9px] font-bold uppercase text-emerald-200 block">Maximum</span>
            <span className="text-sm font-extrabold text-white">{formatXAF(maxAllowed)}</span>
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 font-semibold">
          {error}
        </div>
      )}
      {success && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 font-semibold flex items-center gap-2">
          <span className="material-symbols-outlined text-emerald-700 text-[18px]">check_circle</span>
          <span>{success}</span>
        </div>
      )}
      {directPendingMsg && (
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 font-semibold flex items-center gap-2">
          <LoadingSpinner />
          <span>{directPendingMsg}</span>
        </div>
      )}

      {/* Pending Admin Approval Card (Total repayable > 50 000 FCFA) */}
      {pendingLoan && (
        <div className="rounded-2xl p-4 border-2 border-amber-300 bg-amber-50/70 shadow-xs flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-amber-700 text-[20px]">hourglass_top</span>
            <span className="px-2.5 py-0.5 rounded-full bg-amber-200 text-amber-950 text-[10px] font-extrabold uppercase">
              En attente de validation DIVA Asso
            </span>
          </div>
          <h2 className="text-base font-extrabold text-slate-900">
            Demande de prêt : {formatXAF(pendingLoan.principal)}
          </h2>
          <p className="text-xs text-amber-950 leading-relaxed">
            Votre demande est en cours de vérification par l&apos;administration DIVA Asso. <strong>Votre portefeuille sera rechargé dès validation.</strong>
          </p>
          <div className="grid grid-cols-3 gap-2 text-xs bg-white/80 rounded-xl p-2.5 border border-amber-200/70">
            <div>
              <span className="text-[10px] text-slate-500 block">Montant</span>
              <strong className="text-slate-900">{formatXAF(pendingLoan.principal)}</strong>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 block">Frais DIVA Asso</span>
              <strong className="text-slate-900">{formatXAF(pendingLoan.divaFeeAmount)}</strong>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 block">Total à rembourser</span>
              <strong className="text-emerald-900">{formatXAF(pendingLoan.totalDue)}</strong>
            </div>
          </div>
        </div>
      )}

      {/* Active Loan Countdown & Dual Repayment (Wallet OR Direct Mobile Money +3.1%) */}
      {activeLoan && (() => {
        const dueMs = new Date(activeLoan.dueDate).getTime();
        const remainingMs = Math.max(0, dueMs - nowTick);
        const days = Math.floor(remainingMs / (24 * 60 * 60 * 1000));
        const hours = Math.floor((remainingMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
        const mins = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
        const secs = Math.floor((remainingMs % (60 * 1000)) / 1000);
        const isOverdue = activeLoan.status === "OVERDUE" || remainingMs === 0;
        const directFee = Math.round(activeLoan.remainingDue * 0.031);
        const directTotal = activeLoan.remainingDue + directFee;

        return (
          <div
            className={`rounded-2xl p-4 border-2 shadow-sm flex flex-col gap-3.5 ${
              isOverdue ? "bg-red-50/70 border-red-300" : "bg-white border-emerald-600/30"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                    isOverdue ? "bg-red-600 text-white" : "bg-emerald-100 text-emerald-900"
                  }`}
                >
                  {isOverdue ? "Échéance dépassée" : "Prêt en cours"}
                </span>
                <h2 className="text-lg font-extrabold text-slate-900 mt-1">
                  À rembourser : {formatXAF(activeLoan.remainingDue)}
                </h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  Date limite : <strong>{formatDeadlineDate(new Date(activeLoan.dueDate))} à 18h00</strong>
                </p>
              </div>
              <div className="text-right bg-slate-900 text-white px-2.5 py-1.5 rounded-xl flex-shrink-0">
                <span className="text-[9px] uppercase text-emerald-300 block font-bold">Temps restant</span>
                <span className="font-mono text-xs font-extrabold">
                  {days}j {String(hours).padStart(2, "0")}h {String(mins).padStart(2, "0")}m {String(secs).padStart(2, "0")}s
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs bg-slate-50 rounded-xl p-2.5 border border-slate-200/70">
              <div>
                <span className="text-[10px] text-slate-500 block">Capital</span>
                <strong className="text-slate-900">{formatXAF(activeLoan.principal)}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 block">Intérêts</span>
                <strong className="text-slate-900">{formatXAF(activeLoan.interestAmount)}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 block">Frais DIVA Asso</span>
                <strong className="text-slate-900">{formatXAF(activeLoan.divaFeeAmount)}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 block">Pénalités</span>
                <strong className={activeLoan.penaltyAmount > 0 ? "text-red-600" : "text-slate-900"}>
                  {formatXAF(activeLoan.penaltyAmount)}
                </strong>
              </div>
            </div>

            {/* Repayment Mode Tabs */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setRepayMode("WALLET")}
                className={`py-2 px-3 rounded-xl text-xs font-bold border-2 cursor-pointer transition-colors ${
                  repayMode === "WALLET"
                    ? "border-emerald-600 bg-emerald-50 text-emerald-950"
                    : "border-slate-200 bg-white text-slate-600"
                }`}
              >
                Portefeuille DIVA Asso (0 % frais)
              </button>
              <button
                type="button"
                onClick={() => setRepayMode("DIRECT")}
                className={`py-2 px-3 rounded-xl text-xs font-bold border-2 cursor-pointer transition-colors ${
                  repayMode === "DIRECT"
                    ? "border-emerald-600 bg-emerald-50 text-emerald-950"
                    : "border-slate-200 bg-white text-slate-600"
                }`}
              >
                Paiement direct OM / MTN (+3,1 %)
              </button>
            </div>

            {repayMode === "WALLET" ? (
              <div className="flex flex-col gap-2">
                {walletBalance >= activeLoan.remainingDue ? (
                  <button
                    type="button"
                    disabled={repayingId === activeLoan.id}
                    onClick={() => handleRepayWallet(activeLoan)}
                    className="w-full py-2.5 px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {repayingId === activeLoan.id && <LoadingSpinner />}
                    <span>Rembourser {formatXAF(activeLoan.remainingDue)} via mon Portefeuille</span>
                  </button>
                ) : (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-2.5 font-medium">
                    Solde portefeuille insuffisant pour rembourser intégralement. Utilisez le paiement direct ci-contre ou rechargez votre portefeuille.
                  </p>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-2.5 bg-slate-50 p-3 rounded-xl border border-slate-200">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Numéro Orange Money / MTN MoMo
                  </label>
                  <input
                    type="tel"
                    inputMode="tel"
                    maxLength={9}
                    value={repayPhone}
                    onChange={(e) => setRepayPhone(e.target.value.replace(/\D/g, "").slice(0, 9))}
                    placeholder="6XXXXXXXX"
                    className="w-full border-2 border-emerald-600 rounded-xl px-3 py-2 text-sm font-mono bg-white"
                  />
                  <OperatorBadge operator={repayOperatorInfo} lang={lang} className="mt-1.5" />
                </div>

                {isRepayOperatorSuspended && (
                  <div className="p-2.5 rounded-xl bg-red-50 border border-red-300 text-xs text-red-800 font-semibold">
                    {repaySuspendedReason}
                  </div>
                )}

                <div className="text-xs flex flex-col gap-1 bg-white p-2.5 rounded-lg border border-slate-200">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Montant du remboursement</span>
                    <span className="font-bold">{formatXAF(activeLoan.remainingDue)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Frais opérateur (3,1 %)</span>
                    <span className="font-bold text-amber-800">+{formatXAF(directFee)}</span>
                  </div>
                  <div className="flex justify-between border-t border-slate-100 pt-1 font-extrabold text-emerald-900">
                    <span>Total débité</span>
                    <span>{formatXAF(directTotal)}</span>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={repayingId === activeLoan.id || isRepayOperatorSuspended || repayPhone.length < 9}
                  onClick={() => handleRepayDirect(activeLoan)}
                  className="w-full py-2.5 px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {repayingId === activeLoan.id && <LoadingSpinner />}
                  <span>Payer {formatXAF(directTotal)} maintenant</span>
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {/* Clean Loan Request Card (NO eligibility breakdown, NO formula breakdown, user types amount!) */}
      {!activeLoan && !pendingLoan && (
        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/80 shadow-sm flex flex-col gap-4">
          {!eligibility.eligible || maxAllowed < 1_000 ? (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-950 flex items-center gap-2.5">
              <span className="material-symbols-outlined text-amber-700 text-[20px] flex-shrink-0">lock</span>
              <span className="font-semibold">
                Vous n&apos;êtes pas encore éligible au prêt d&apos;urgence pour le moment.
              </span>
            </div>
          ) : (
            <form onSubmit={handleContinue} className="flex flex-col gap-4">
              <div className="flex items-center justify-between bg-emerald-50/70 border border-emerald-200 rounded-xl px-3.5 py-2.5">
                <span className="text-xs font-bold text-emerald-950">Montant maximum autorisé</span>
                <span className="text-base font-extrabold text-emerald-800">{formatXAF(maxAllowed)}</span>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Combien souhaitez-vous emprunter ? (FCFA)
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={amountInput}
                    onChange={(e) => setAmountInput(sanitizeDigits(e.target.value))}
                    placeholder={`Entre 1 000 et ${maxAllowed.toLocaleString("fr-FR")}`}
                    className="w-full border-2 border-emerald-600 focus:border-emerald-700 focus:outline-none rounded-xl px-3.5 py-2.5 pr-14 text-base font-extrabold text-slate-900 bg-white"
                  />
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                    FCFA
                  </span>
                </div>
                {typedAmount > maxAllowed && (
                  <p className="text-[11px] text-red-600 font-semibold mt-1">
                    Ce montant dépasse votre maximum autorisé ({formatXAF(maxAllowed)}).
                  </p>
                )}
              </div>

              {typedAmount > 0 && typedAmount <= maxAllowed && (
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 flex flex-col gap-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Montant du prêt</span>
                    <span className="font-bold text-slate-900">{formatXAF(typedAmount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Intérêts</span>
                    <span className="font-bold text-slate-900">+{formatXAF(simulatedInterest)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Frais DIVA Asso</span>
                    <span className="font-bold text-slate-900">+{formatXAF(simulatedDivaFee)}</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-slate-200 text-sm">
                    <span className="font-extrabold text-slate-900">Total à rembourser</span>
                    <span className="font-extrabold text-emerald-800">{formatXAF(simulatedTotal)}</span>
                  </div>

                  <div className="mt-1 pt-2 border-t border-slate-200/80 text-[11px] text-slate-600 flex flex-col gap-1">
                    <p>
                      Date limite de remboursement :{" "}
                      <strong className="text-slate-900">{simulatedDueDateLabel} à 18h00</strong>
                    </p>
                    <p className="text-amber-800">
                      Si à cette date à 18h00 le prêt n&apos;est pas remboursé, une pénalité de +5 % sera ajoutée après 2 jours de retard.
                    </p>
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={!isAmountValid || submitting}
                className="w-full py-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 active:scale-[0.99] text-white font-bold text-sm cursor-pointer disabled:opacity-40 transition-all shadow-sm"
              >
                Continuer
              </button>
            </form>
          )}
        </div>
      )}

      {/* Confirmation Commitment Modal */}
      {showConfirmModal && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => !submitting && setShowConfirmModal(false)}
        >
          <div
            className="bg-white rounded-3xl max-w-md w-full p-5 sm:p-6 shadow-2xl border border-slate-200 flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-extrabold text-slate-900">
                Confirmation de votre engagement
              </h3>
              <button
                type="button"
                disabled={submitting}
                onClick={() => setShowConfirmModal(false)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="flex flex-col gap-2.5 text-xs text-slate-700 leading-relaxed bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
              <p>
                En validant cette demande, j&apos;accepte de rembourser la somme totale de{" "}
                <strong className="text-emerald-900">{formatXAF(simulatedTotal)}</strong> au plus tard le{" "}
                <strong className="text-slate-900">{simulatedDueDateLabel} à 18h00</strong>.
              </p>
              <p>
                • Si mon tour de bouffe arrive avant cette date, le prêt sera{" "}
                <strong>automatiquement remboursé à la source</strong> sur ma cagnotte.
              </p>
              <p>
                • En cas de retard de <strong>2 jours</strong> après le {simulatedDueDateLabel} à 18h00,{" "}
                <strong>+5 % d&apos;intérêts supplémentaires</strong> seront appliqués.
              </p>
              {requiresAdmin ? (
                <p className="text-amber-900 bg-amber-50 border border-amber-200 rounded-xl p-2 font-semibold">
                  Le total à rembourser dépassant 50 000 FCFA, votre demande sera soumise à la validation de l&apos;administrateur DIVA Asso avant le crédit dans votre portefeuille.
                </p>
              ) : (
                <p className="text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-xl p-2 font-semibold">
                  Votre Portefeuille DIVA Asso sera crédité automatiquement de {formatXAF(typedAmount)} dès confirmation.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setShowConfirmModal(false)}
                className="py-2.5 rounded-xl border border-slate-200 text-slate-700 font-bold text-xs cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleConfirmLoanSubmit}
                className="py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {submitting && <LoadingSpinner />}
                <span>Confirmer et valider</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
