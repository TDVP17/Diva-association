"use client";

import { useState } from "react";
import { LoadingSpinner } from "@/components/loading-spinner";
import type { GlobalWithdrawalLimits } from "@/lib/withdrawal-limits";
import type { Lang } from "@/lib/i18n/translations";

function sanitizeDigits(raw: string): string {
  const d = raw.replace(/\D/g, "");
  return d ? d.replace(/^0+(?=\d)/, "") : "";
}

export function WithdrawalLimitsEditor({
  initialLimits,
  lang,
}: {
  initialLimits: GlobalWithdrawalLimits;
  lang: Lang;
}) {
  const [minInput, setMinInput] = useState(String(initialLimits.minWithdrawalAmount));
  const [maxInput, setMaxInput] = useState(String(initialLimits.maxWithdrawalAmount));
  const [thresholdInput, setThresholdInput] = useState(String(initialLimits.withdrawalApprovalThreshold ?? 50000));
  const [minTopupInput, setMinTopupInput] = useState(String(initialLimits.minTopupAmount ?? 500));
  const [maxTopupInput, setMaxTopupInput] = useState(String(initialLimits.maxTopupAmount ?? 500000));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    const minVal = parseInt(minInput, 10) || 0;
    const maxVal = parseInt(maxInput, 10) || 0;
    const thresholdVal = parseInt(thresholdInput, 10) || 50000;
    const minTopupVal = parseInt(minTopupInput, 10) || 0;
    const maxTopupVal = parseInt(maxTopupInput, 10) || 0;

    if (minVal < 100 || maxVal < minVal) {
      setStatus({
        type: "err",
        text: "Le minimum de retrait doit être ≥ 100 FCFA et le maximum ≥ au minimum.",
      });
      return;
    }

    if (minTopupVal < 100 || maxTopupVal < minTopupVal) {
      setStatus({
        type: "err",
        text: "Le minimum de recharge doit être ≥ 100 FCFA et le maximum ≥ au minimum.",
      });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/admin/withdrawal-limits", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          minWithdrawalAmount: minVal,
          maxWithdrawalAmount: maxVal,
          withdrawalApprovalThreshold: thresholdVal,
          minTopupAmount: minTopupVal,
          maxTopupAmount: maxTopupVal,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus({ type: "err", text: data.error || "Erreur lors de l'enregistrement." });
        return;
      }
      setStatus({
        type: "ok",
        text:
          lang === "fr"
            ? "Plafonds de recharge, retrait et seuil de validation enregistrés !"
            : "Global top-up and withdrawal limits saved successfully!",
      });
    } catch {
      setStatus({ type: "err", text: "Erreur réseau." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-3">
      <p className="text-xs text-slate-600">
        {lang === "fr"
          ? "Définissez les montants minimum et maximum autorisés par transaction (instantanée) pour les recharges et retraits, ainsi que le seuil de validation admin."
          : "Define instant minimum and maximum limits per transaction for top-ups and withdrawals, and the manual admin approval threshold."}
      </p>

      {/* Recharges */}
      <div className="bg-emerald-50/60 border border-emerald-200/80 rounded-xl p-3">
        <h4 className="text-xs font-bold text-emerald-950 mb-2 flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[16px] text-emerald-700">add_card</span>
          {lang === "fr" ? "Recharges Portefeuille (par opération)" : "Wallet Top-Ups (per transaction)"}
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1">
              Minimum recharge (FCFA)
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={minTopupInput}
              onChange={(e) => setMinTopupInput(sanitizeDigits(e.target.value))}
              className="w-full border-2 border-emerald-600 rounded-xl px-3 py-2 text-sm font-bold bg-white"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1">
              Maximum recharge (FCFA)
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={maxTopupInput}
              onChange={(e) => setMaxTopupInput(sanitizeDigits(e.target.value))}
              className="w-full border-2 border-emerald-600 rounded-xl px-3 py-2 text-sm font-bold bg-white"
            />
          </div>
        </div>
      </div>

      {/* Retraits */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
        <h4 className="text-xs font-bold text-slate-900 mb-2 flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[16px] text-slate-700">payments</span>
          {lang === "fr" ? "Retraits Portefeuille (par opération)" : "Wallet Withdrawals (per transaction)"}
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1">
              Minimum retrait (FCFA)
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={minInput}
              onChange={(e) => setMinInput(sanitizeDigits(e.target.value))}
              className="w-full border-2 border-emerald-600 rounded-xl px-3 py-2 text-sm font-bold bg-white"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1">
              Maximum retrait (FCFA)
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={maxInput}
              onChange={(e) => setMaxInput(sanitizeDigits(e.target.value))}
              className="w-full border-2 border-emerald-600 rounded-xl px-3 py-2 text-sm font-bold bg-white"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1">
              Seuil validation Admin (FCFA)
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={thresholdInput}
              onChange={(e) => setThresholdInput(sanitizeDigits(e.target.value))}
              className="w-full border-2 border-amber-600 rounded-xl px-3 py-2 text-sm font-bold bg-white"
            />
            <span className="text-[10px] text-slate-500 mt-0.5 block">
              Dès ce montant : validation requise
            </span>
          </div>
        </div>
      </div>

      {status && (
        <p
          className={`text-xs font-semibold ${
            status.type === "ok" ? "text-emerald-700" : "text-red-600"
          }`}
        >
          {status.text}
        </p>
      )}

      <button
        type="submit"
        disabled={saving}
        className="w-full py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {saving && <LoadingSpinner />}
        <span>{lang === "fr" ? "Enregistrer les plafonds globaux" : "Save Global Limits"}</span>
      </button>
    </form>
  );
}

