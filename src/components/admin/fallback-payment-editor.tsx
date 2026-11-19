"use client";

import { useEffect, useState } from "react";
import { translate, type Lang } from "@/lib/i18n/translations";
import { formatXAF } from "@/lib/format-currency";
import {
  formatMerchantUssdCode,
  type FallbackPaymentConfigData,
} from "@/lib/fallback-ussd";

export function FallbackPaymentEditor({
  lang,
  initialConfig,
  samplePerSlotAmount = 1550,
}: {
  lang: Lang;
  initialConfig?: FallbackPaymentConfigData;
  samplePerSlotAmount?: number;
}) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) =>
    translate(lang, key, vars);

  const [isEnabled, setIsEnabled] = useState<boolean>(initialConfig?.isEnabled ?? true);
  const [orangeUssdCode, setOrangeUssdCode] = useState(initialConfig?.orangeUssdCode ?? "");
  const [orangeBeneficiaryName, setOrangeBeneficiaryName] = useState(
    initialConfig?.orangeBeneficiaryName ?? "",
  );
  const [mtnUssdCode, setMtnUssdCode] = useState(initialConfig?.mtnUssdCode ?? "");
  const [mtnBeneficiaryName, setMtnBeneficiaryName] = useState(
    initialConfig?.mtnBeneficiaryName ?? "",
  );

  // Suspension des opérateurs (Globale & Granulaire)
  const [isOrangeSuspended, setIsOrangeSuspended] = useState<boolean>(
    initialConfig?.isOrangeSuspended ?? false,
  );
  const [orangeSuspendedReason, setOrangeSuspendedReason] = useState(
    initialConfig?.orangeSuspendedReason ?? "",
  );
  const [isMtnSuspended, setIsMtnSuspended] = useState<boolean>(
    initialConfig?.isMtnSuspended ?? false,
  );
  const [mtnSuspendedReason, setMtnSuspendedReason] = useState(
    initialConfig?.mtnSuspendedReason ?? "",
  );

  // Granulaire Entrées (Cash-In) vs Sorties (Cash-Out)
  const [orangeCashInEnabled, setOrangeCashInEnabled] = useState<boolean>(
    initialConfig?.orangeCashInEnabled ?? true,
  );
  const [orangeCashOutEnabled, setOrangeCashOutEnabled] = useState<boolean>(
    initialConfig?.orangeCashOutEnabled ?? true,
  );
  const [orangeCashInDisabledReason, setOrangeCashInDisabledReason] = useState(
    initialConfig?.orangeCashInDisabledReason ?? "",
  );
  const [orangeCashOutDisabledReason, setOrangeCashOutDisabledReason] = useState(
    initialConfig?.orangeCashOutDisabledReason ?? "",
  );

  const [mtnCashInEnabled, setMtnCashInEnabled] = useState<boolean>(
    initialConfig?.mtnCashInEnabled ?? true,
  );
  const [mtnCashOutEnabled, setMtnCashOutEnabled] = useState<boolean>(
    initialConfig?.mtnCashOutEnabled ?? true,
  );
  const [mtnCashInDisabledReason, setMtnCashInDisabledReason] = useState(
    initialConfig?.mtnCashInDisabledReason ?? "",
  );
  const [mtnCashOutDisabledReason, setMtnCashOutDisabledReason] = useState(
    initialConfig?.mtnCashOutDisabledReason ?? "",
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    if (initialConfig) return;
    let cancelled = false;
    fetch("/api/payments/fallback-config")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: FallbackPaymentConfigData | null) => {
        if (!data || cancelled) return;
        setIsEnabled(data.isEnabled ?? true);
        setOrangeUssdCode(data.orangeUssdCode ?? "");
        setOrangeBeneficiaryName(data.orangeBeneficiaryName ?? "");
        setMtnUssdCode(data.mtnUssdCode ?? "");
        setMtnBeneficiaryName(data.mtnBeneficiaryName ?? "");
        setIsOrangeSuspended(data.isOrangeSuspended ?? false);
        setOrangeSuspendedReason(data.orangeSuspendedReason ?? "");
        setIsMtnSuspended(data.isMtnSuspended ?? false);
        setMtnSuspendedReason(data.mtnSuspendedReason ?? "");
        setOrangeCashInEnabled(data.orangeCashInEnabled ?? true);
        setOrangeCashOutEnabled(data.orangeCashOutEnabled ?? true);
        setOrangeCashInDisabledReason(data.orangeCashInDisabledReason ?? "");
        setOrangeCashOutDisabledReason(data.orangeCashOutDisabledReason ?? "");
        setMtnCashInEnabled(data.mtnCashInEnabled ?? true);
        setMtnCashOutEnabled(data.mtnCashOutEnabled ?? true);
        setMtnCashInDisabledReason(data.mtnCashInDisabledReason ?? "");
        setMtnCashOutDisabledReason(data.mtnCashOutDisabledReason ?? "");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [initialConfig]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSavedMsg(null);
    try {
      const res = await fetch("/api/payments/fallback-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isEnabled,
          orangeUssdCode,
          orangeBeneficiaryName,
          mtnUssdCode,
          mtnBeneficiaryName,
          isOrangeSuspended,
          orangeSuspendedReason,
          isMtnSuspended,
          mtnSuspendedReason,
          orangeCashInEnabled,
          orangeCashOutEnabled,
          orangeCashInDisabledReason,
          orangeCashOutDisabledReason,
          mtnCashInEnabled,
          mtnCashOutEnabled,
          mtnCashInDisabledReason,
          mtnCashOutDisabledReason,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error || t("somethingWentWrong"));
        return;
      }
      setSavedMsg(t("fallbackConfigSaved"));
      setTimeout(() => setSavedMsg(null), 4000);
    } catch {
      setError(t("somethingWentWrong"));
    } finally {
      setSaving(false);
    }
  }

  async function toggleGranular(field: "orangeCashIn" | "orangeCashOut" | "mtnCashIn" | "mtnCashOut") {
    let nextOrangeCashIn = orangeCashInEnabled;
    let nextOrangeCashOut = orangeCashOutEnabled;
    let nextMtnCashIn = mtnCashInEnabled;
    let nextMtnCashOut = mtnCashOutEnabled;

    let actionLabel = "";
    if (field === "orangeCashIn") {
      nextOrangeCashIn = !orangeCashInEnabled;
      setOrangeCashInEnabled(nextOrangeCashIn);
      actionLabel = nextOrangeCashIn
        ? (lang === "fr" ? "Dépôts & Paiements Orange Money réactivés !" : "Orange Money deposits reactivated!")
        : (lang === "fr" ? "Dépôts & Paiements Orange Money désactivés." : "Orange Money deposits disabled.");
    } else if (field === "orangeCashOut") {
      nextOrangeCashOut = !orangeCashOutEnabled;
      setOrangeCashOutEnabled(nextOrangeCashOut);
      actionLabel = nextOrangeCashOut
        ? (lang === "fr" ? "Retraits Orange Money réactivés !" : "Orange Money withdrawals reactivated!")
        : (lang === "fr" ? "Retraits Orange Money désactivés." : "Orange Money withdrawals disabled.");
    } else if (field === "mtnCashIn") {
      nextMtnCashIn = !mtnCashInEnabled;
      setMtnCashInEnabled(nextMtnCashIn);
      actionLabel = nextMtnCashIn
        ? (lang === "fr" ? "Dépôts & Paiements MTN MoMo réactivés !" : "MTN MoMo deposits reactivated!")
        : (lang === "fr" ? "Dépôts & Paiements MTN MoMo désactivés." : "MTN MoMo deposits disabled.");
    } else if (field === "mtnCashOut") {
      nextMtnCashOut = !mtnCashOutEnabled;
      setMtnCashOutEnabled(nextMtnCashOut);
      actionLabel = nextMtnCashOut
        ? (lang === "fr" ? "Retraits MTN MoMo réactivés !" : "MTN MoMo withdrawals reactivated!")
        : (lang === "fr" ? "Retraits MTN MoMo désactivés." : "MTN MoMo withdrawals disabled.");
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/payments/fallback-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isEnabled,
          orangeUssdCode,
          orangeBeneficiaryName,
          mtnUssdCode,
          mtnBeneficiaryName,
          isOrangeSuspended,
          orangeSuspendedReason,
          isMtnSuspended,
          mtnSuspendedReason,
          orangeCashInEnabled: nextOrangeCashIn,
          orangeCashOutEnabled: nextOrangeCashOut,
          orangeCashInDisabledReason,
          orangeCashOutDisabledReason,
          mtnCashInEnabled: nextMtnCashIn,
          mtnCashOutEnabled: nextMtnCashOut,
          mtnCashInDisabledReason,
          mtnCashOutDisabledReason,
        }),
      });
      if (res.ok) {
        setSavedMsg(actionLabel);
        setTimeout(() => setSavedMsg(null), 3500);
      } else {
        const d = await res.json().catch(() => null);
        setError(d?.error || "Erreur de mise à jour");
        if (field === "orangeCashIn") setOrangeCashInEnabled(!nextOrangeCashIn);
        if (field === "orangeCashOut") setOrangeCashOutEnabled(!nextOrangeCashOut);
        if (field === "mtnCashIn") setMtnCashInEnabled(!nextMtnCashIn);
        if (field === "mtnCashOut") setMtnCashOutEnabled(!nextMtnCashOut);
      }
    } catch {
      setError("Erreur de connexion.");
      if (field === "orangeCashIn") setOrangeCashInEnabled(!nextOrangeCashIn);
      if (field === "orangeCashOut") setOrangeCashOutEnabled(!nextOrangeCashOut);
      if (field === "mtnCashIn") setMtnCashInEnabled(!nextMtnCashIn);
      if (field === "mtnCashOut") setMtnCashOutEnabled(!nextMtnCashOut);
    } finally {
      setSaving(false);
    }
  }

  async function toggleOperator(operator: "ORANGE" | "MTN") {
    const nextOrange = operator === "ORANGE" ? !isOrangeSuspended : isOrangeSuspended;
    const nextMtn = operator === "MTN" ? !isMtnSuspended : isMtnSuspended;

    if (operator === "ORANGE") setIsOrangeSuspended(nextOrange);
    if (operator === "MTN") setIsMtnSuspended(nextMtn);

    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/payments/fallback-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isEnabled,
          orangeUssdCode,
          orangeBeneficiaryName,
          mtnUssdCode,
          mtnBeneficiaryName,
          isOrangeSuspended: nextOrange,
          orangeSuspendedReason,
          isMtnSuspended: nextMtn,
          mtnSuspendedReason,
          orangeCashInEnabled,
          orangeCashOutEnabled,
          orangeCashInDisabledReason,
          orangeCashOutDisabledReason,
          mtnCashInEnabled,
          mtnCashOutEnabled,
          mtnCashInDisabledReason,
          mtnCashOutDisabledReason,
        }),
      });
      if (res.ok) {
        setSavedMsg(
          operator === "ORANGE"
            ? nextOrange
              ? (lang === "fr" ? "Orange Money suspendu avec succès." : "Orange Money suspended.")
              : (lang === "fr" ? "Orange Money réactivé avec succès !" : "Orange Money reactivated!")
            : nextMtn
              ? (lang === "fr" ? "MTN Mobile Money suspendu avec succès." : "MTN Mobile Money suspended.")
              : (lang === "fr" ? "MTN Mobile Money réactivé avec succès !" : "MTN Mobile Money reactivated!")
        );
        setTimeout(() => setSavedMsg(null), 3500);
      } else {
        const d = await res.json().catch(() => null);
        setError(d?.error || "Erreur de mise à jour");
        if (operator === "ORANGE") setIsOrangeSuspended(!nextOrange);
        if (operator === "MTN") setIsMtnSuspended(!nextMtn);
      }
    } catch {
      setError("Erreur de connexion lors de la mise à jour de la suspension.");
      if (operator === "ORANGE") setIsOrangeSuspended(!nextOrange);
      if (operator === "MTN") setIsMtnSuspended(!nextMtn);
    } finally {
      setSaving(false);
    }
  }

  const perSlot = samplePerSlotAmount > 0 ? samplePerSlotAmount : 1550;
  const orangePreview1 = formatMerchantUssdCode(orangeUssdCode, perSlot, "ORANGE");
  const orangePreview2 = formatMerchantUssdCode(orangeUssdCode, perSlot * 2, "ORANGE");
  const mtnPreview1 = formatMerchantUssdCode(mtnUssdCode, perSlot, "MTN");
  const mtnPreview2 = formatMerchantUssdCode(mtnUssdCode, perSlot * 2, "MTN");

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-5">
      {/* SECTION 1 : SUSPENSION TEMPORAIRE DES OPÉRATEURS (ORANGE / MTN) */}
      <div className="p-4 rounded-2xl border-2 border-red-500/30 bg-red-50/20 flex flex-col gap-4 shadow-xs">
        <div className="flex items-start gap-2.5">
          <span className="material-symbols-outlined text-red-600 text-2xl flex-shrink-0 mt-0.5">pause_circle</span>
          <div>
            <h4 className="font-bold text-sm text-slate-900">
              {lang === "fr" ? "Suspension temporaire d'un opérateur (Orange / MTN)" : "Temporary operator suspension (Orange / MTN)"}
            </h4>
            <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
              {lang === "fr"
                ? "Activez la suspension d'un opérateur si ses paiements sont en panne ou indisponibles. Lorsqu'un membre entre un numéro de cet opérateur, une alerte rouge affichera votre message et le paiement passera obligatoirement via l'opérateur opposé."
                : "Suspend an operator when down. Members entering that operator's number will see your red alert message and will be required to use the opposite operator."}
            </p>
          </div>
        </div>

        {savedMsg && (
          <div className="p-2.5 rounded-xl bg-emerald-100 border border-emerald-300 text-emerald-900 font-bold text-xs flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px] text-emerald-700">check_circle</span>
            <span>{savedMsg}</span>
          </div>
        )}
        {error && (
          <div className="p-2.5 rounded-xl bg-red-100 border border-red-300 text-red-900 font-bold text-xs flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px] text-red-700">error</span>
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* ORANGE MONEY CONTROLS */}
          <div className={`p-3.5 rounded-xl border-2 transition-all flex flex-col gap-3.5 ${
            isOrangeSuspended || (!orangeCashInEnabled && !orangeCashOutEnabled)
              ? "border-red-500 bg-red-50/80 shadow-xs"
              : "border-orange-200 bg-white"
          }`}>
            <div className="flex items-center justify-between gap-2 border-b border-orange-100 pb-2.5">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded font-bold text-[11px] bg-[#FF6600] text-white">
                  Orange Money
                </span>
                <span className="text-xs font-bold text-slate-900">
                  {lang === "fr" ? "Disponibilité Générale" : "General Availability"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => toggleOperator("ORANGE")}
                disabled={saving}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 ${
                  isOrangeSuspended ? "bg-red-600" : "bg-slate-300"
                }`}
                role="switch"
                aria-checked={isOrangeSuspended}
                title={isOrangeSuspended ? "Désactiver la suspension totale" : "Suspendre totalement Orange"}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    isOrangeSuspended ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {/* Granular: Orange Cash-In (Entrées) */}
            <div className="flex flex-col gap-2 p-2.5 rounded-lg bg-orange-50/60 border border-orange-200/80">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-slate-900 block">
                    {lang === "fr" ? "Dépôts & Paiements (Cash-In)" : "Deposits & Payments (Cash-In)"}
                  </span>
                  <span className="text-[10px] text-slate-600 block">
                    {lang === "fr" ? "Recharges, cotisations, remboursements de prêts" : "Top-ups, contributions, loan repayments"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => toggleGranular("orangeCashIn")}
                  disabled={saving || isOrangeSuspended}
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-40 ${
                    orangeCashInEnabled && !isOrangeSuspended ? "bg-emerald-600" : "bg-red-500"
                  }`}
                  title={orangeCashInEnabled ? "Désactiver les dépôts Orange" : "Activer les dépôts Orange"}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      orangeCashInEnabled && !isOrangeSuspended ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
              {!orangeCashInEnabled && !isOrangeSuspended && (
                <input
                  type="text"
                  value={orangeCashInDisabledReason}
                  onChange={(e) => setOrangeCashInDisabledReason(e.target.value)}
                  onBlur={handleSave}
                  placeholder={
                    lang === "fr"
                      ? "Message personnalisé (Optionnel) : Ex. Dépôts Orange temporairement indisponibles"
                      : "Optional custom message for disabled Cash-In"
                  }
                  className="w-full rounded-md border border-red-300 bg-white p-1.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-red-500"
                />
              )}
            </div>

            {/* Granular: Orange Cash-Out (Sorties) */}
            <div className="flex flex-col gap-2 p-2.5 rounded-lg bg-orange-50/60 border border-orange-200/80">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-slate-900 block">
                    {lang === "fr" ? "Retraits & Décaissements (Cash-Out)" : "Withdrawals & Payouts (Cash-Out)"}
                  </span>
                  <span className="text-[10px] text-slate-600 block">
                    {lang === "fr" ? "Retraits de portefeuille, gains cagnottes" : "Wallet withdrawals, pot payouts"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => toggleGranular("orangeCashOut")}
                  disabled={saving || isOrangeSuspended}
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-40 ${
                    orangeCashOutEnabled && !isOrangeSuspended ? "bg-emerald-600" : "bg-red-500"
                  }`}
                  title={orangeCashOutEnabled ? "Désactiver les retraits Orange" : "Activer les retraits Orange"}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      orangeCashOutEnabled && !isOrangeSuspended ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
              {!orangeCashOutEnabled && !isOrangeSuspended && (
                <input
                  type="text"
                  value={orangeCashOutDisabledReason}
                  onChange={(e) => setOrangeCashOutDisabledReason(e.target.value)}
                  onBlur={handleSave}
                  placeholder={
                    lang === "fr"
                      ? "Message personnalisé (Optionnel) : Ex. Retraits Orange indisponibles"
                      : "Optional custom message for disabled Cash-Out"
                  }
                  className="w-full rounded-md border border-red-300 bg-white p-1.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-red-500"
                />
              )}
            </div>

            {isOrangeSuspended && (
              <div className="flex flex-col gap-1.5 animate-fadeIn">
                <label className="text-[11px] font-bold text-red-950 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px] text-red-600">notification_important</span>
                  {lang === "fr" ? "Message d'alerte rouge affiché aux membres :" : "Red alert message shown to members:"}
                </label>
                <textarea
                  rows={2}
                  value={orangeSuspendedReason}
                  onChange={(e) => setOrangeSuspendedReason(e.target.value)}
                  onBlur={handleSave}
                  placeholder={
                    lang === "fr"
                      ? "Ex: Les paiements via Orange Money sont indisponibles pour le moment. Veuillez utiliser MTN Mobile Money."
                      : "e.g. Orange Money payments are temporarily unavailable. Please pay with MTN Mobile Money."
                  }
                  className="w-full rounded-lg border border-red-300 bg-white p-2 text-xs text-slate-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                />
              </div>
            )}
          </div>

          {/* MTN MOBILE MONEY CONTROLS */}
          <div className={`p-3.5 rounded-xl border-2 transition-all flex flex-col gap-3.5 ${
            isMtnSuspended || (!mtnCashInEnabled && !mtnCashOutEnabled)
              ? "border-red-500 bg-red-50/80 shadow-xs"
              : "border-amber-200 bg-white"
          }`}>
            <div className="flex items-center justify-between gap-2 border-b border-amber-100 pb-2.5">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded font-bold text-[11px] bg-yellow-400 text-slate-950">
                  MTN MoMo
                </span>
                <span className="text-xs font-bold text-slate-900">
                  {lang === "fr" ? "Disponibilité Générale" : "General Availability"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => toggleOperator("MTN")}
                disabled={saving}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 ${
                  isMtnSuspended ? "bg-red-600" : "bg-slate-300"
                }`}
                role="switch"
                aria-checked={isMtnSuspended}
                title={isMtnSuspended ? "Désactiver la suspension totale" : "Suspendre totalement MTN"}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    isMtnSuspended ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {/* Granular: MTN Cash-In (Entrées) */}
            <div className="flex flex-col gap-2 p-2.5 rounded-lg bg-amber-50/60 border border-amber-200/80">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-slate-900 block">
                    {lang === "fr" ? "Dépôts & Paiements (Cash-In)" : "Deposits & Payments (Cash-In)"}
                  </span>
                  <span className="text-[10px] text-slate-600 block">
                    {lang === "fr" ? "Recharges, cotisations, remboursements de prêts" : "Top-ups, contributions, loan repayments"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => toggleGranular("mtnCashIn")}
                  disabled={saving || isMtnSuspended}
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-40 ${
                    mtnCashInEnabled && !isMtnSuspended ? "bg-emerald-600" : "bg-red-500"
                  }`}
                  title={mtnCashInEnabled ? "Désactiver les dépôts MTN" : "Activer les dépôts MTN"}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      mtnCashInEnabled && !isMtnSuspended ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
              {!mtnCashInEnabled && !isMtnSuspended && (
                <input
                  type="text"
                  value={mtnCashInDisabledReason}
                  onChange={(e) => setMtnCashInDisabledReason(e.target.value)}
                  onBlur={handleSave}
                  placeholder={
                    lang === "fr"
                      ? "Message personnalisé (Optionnel) : Ex. Dépôts MTN temporairement indisponibles"
                      : "Optional custom message for disabled Cash-In"
                  }
                  className="w-full rounded-md border border-red-300 bg-white p-1.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-red-500"
                />
              )}
            </div>

            {/* Granular: MTN Cash-Out (Sorties) */}
            <div className="flex flex-col gap-2 p-2.5 rounded-lg bg-amber-50/60 border border-amber-200/80">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-slate-900 block">
                    {lang === "fr" ? "Retraits & Décaissements (Cash-Out)" : "Withdrawals & Payouts (Cash-Out)"}
                  </span>
                  <span className="text-[10px] text-slate-600 block">
                    {lang === "fr" ? "Retraits de portefeuille, gains cagnottes" : "Wallet withdrawals, pot payouts"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => toggleGranular("mtnCashOut")}
                  disabled={saving || isMtnSuspended}
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-40 ${
                    mtnCashOutEnabled && !isMtnSuspended ? "bg-emerald-600" : "bg-red-500"
                  }`}
                  title={mtnCashOutEnabled ? "Désactiver les retraits MTN" : "Activer les retraits MTN"}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      mtnCashOutEnabled && !isMtnSuspended ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
              {!mtnCashOutEnabled && !isMtnSuspended && (
                <input
                  type="text"
                  value={mtnCashOutDisabledReason}
                  onChange={(e) => setMtnCashOutDisabledReason(e.target.value)}
                  onBlur={handleSave}
                  placeholder={
                    lang === "fr"
                      ? "Message personnalisé (Optionnel) : Ex. Retraits MTN indisponibles"
                      : "Optional custom message for disabled Cash-Out"
                  }
                  className="w-full rounded-md border border-red-300 bg-white p-1.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-red-500"
                />
              )}
            </div>

            {isMtnSuspended && (
              <div className="flex flex-col gap-1.5 animate-fadeIn">
                <label className="text-[11px] font-bold text-red-950 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px] text-red-600">notification_important</span>
                  {lang === "fr" ? "Message d'alerte rouge affiché aux membres :" : "Red alert message shown to members:"}
                </label>
                <textarea
                  rows={2}
                  value={mtnSuspendedReason}
                  onChange={(e) => setMtnSuspendedReason(e.target.value)}
                  onBlur={handleSave}
                  placeholder={
                    lang === "fr"
                      ? "Ex: Les paiements via MTN Mobile Money sont indisponibles pour le moment. Veuillez effectuer votre paiement avec Orange Money."
                      : "e.g. MTN Mobile Money payments are temporarily unavailable. Please pay with Orange Money."
                  }
                  className="w-full rounded-lg border border-red-300 bg-white p-2 text-xs text-slate-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* SECTION 2 : CODE MARCHAND DE SECOURS (USSD FALLBACK) */}
      <div className="p-3.5 rounded-xl border border-outline-variant bg-surface-container-lowest flex items-center justify-between gap-3 shadow-2xs">
        <div>
          <span className="font-bold text-sm text-on-surface block">
            {lang === "fr" ? "Paiement par code marchand de secours" : "Fallback merchant payment"}
          </span>
          <span className="text-xs text-on-surface-variant block mt-0.5">
            {isEnabled
              ? lang === "fr"
                ? "Actif : En cas de défaillance réseau persistante, les membres verront les codes marchands ci-dessous."
                : "Active: When auto-payment fails repeatedly, members will see the merchant codes below."
              : lang === "fr"
                ? "Désactivé : En cas d'échec, le membre est invité à vérifier son solde, utiliser l'opérateur opposé ou réessayer plus tard."
                : "Disabled: When auto-payment fails, member is asked to check balance, use opposing operator or retry later."}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setIsEnabled(!isEnabled)}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
            isEnabled ? "bg-emerald-600" : "bg-slate-300"
          }`}
          role="switch"
          aria-checked={isEnabled}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
              isEnabled ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      <p className="text-xs text-on-surface-variant leading-relaxed">
        {t("fallbackConfigDesc")}
      </p>

      <div
        className={`transition-opacity duration-200 flex flex-col gap-4 ${
          !isEnabled ? "opacity-50 pointer-events-none" : ""
        }`}
      >
        <div className="p-3 rounded-xl border border-orange-300 bg-orange-50/50 flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded font-bold text-[11px] bg-[#FF6600] text-white">
              Orange Money
            </span>
            <span className="text-xs font-bold text-orange-950">
              {t("orangeMerchantCodeTitle")}
            </span>
          </div>

          <div>
            <label className="block text-xs font-semibold text-orange-950 mb-1">
              {t("fallbackOrangeCodeLabel")}
            </label>
            <input
              type="text"
              value={orangeUssdCode}
              onChange={(e) => setOrangeUssdCode(e.target.value)}
              placeholder={t("fallbackOrangeCodePlaceholder")}
              className="w-full rounded-lg border border-orange-300 bg-white px-3 py-2 text-sm font-mono text-on-surface"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-orange-950 mb-1">
              {t("fallbackOrangeBeneficiaryLabel")}
            </label>
            <input
              type="text"
              value={orangeBeneficiaryName}
              onChange={(e) => setOrangeBeneficiaryName(e.target.value)}
              placeholder={t("fallbackOrangeBeneficiaryPlaceholder")}
              className="w-full rounded-lg border border-orange-300 bg-white px-3 py-2 text-sm text-on-surface"
            />
          </div>

          {orangePreview1 && (
            <div className="rounded-lg bg-white/90 border border-orange-200 p-2 text-[11px] text-orange-950 flex flex-col gap-0.5">
              <span>
                • 1 nom ({formatXAF(perSlot)}) : <code className="font-mono font-bold">{orangePreview1}</code>
              </span>
              <span>
                • 2 noms ({formatXAF(perSlot * 2)}) : <code className="font-mono font-bold">{orangePreview2}</code>
              </span>
            </div>
          )}
        </div>

        <div className="p-3 rounded-xl border border-amber-300 bg-amber-50/50 flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded font-bold text-[11px] bg-yellow-400 text-slate-950">
              MTN MoMo
            </span>
            <span className="text-xs font-bold text-amber-950">
              {t("mtnMerchantCodeTitle")}
            </span>
          </div>

          <div>
            <label className="block text-xs font-semibold text-amber-950 mb-1">
              {t("fallbackMtnCodeLabel")}
            </label>
            <input
              type="text"
              value={mtnUssdCode}
              onChange={(e) => setMtnUssdCode(e.target.value)}
              placeholder={t("fallbackMtnCodePlaceholder")}
              className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-mono text-on-surface"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-amber-950 mb-1">
              {t("fallbackMtnBeneficiaryLabel")}
            </label>
            <input
              type="text"
              value={mtnBeneficiaryName}
              onChange={(e) => setMtnBeneficiaryName(e.target.value)}
              placeholder={t("fallbackMtnBeneficiaryPlaceholder")}
              className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-on-surface"
            />
          </div>

          {mtnPreview1 && (
            <div className="rounded-lg bg-white/90 border border-amber-200 p-2 text-[11px] text-amber-950 flex flex-col gap-0.5">
              <span>
                • 1 nom ({formatXAF(perSlot)}) : <code className="font-mono font-bold">{mtnPreview1}</code>
              </span>
              <span>
                • 2 noms ({formatXAF(perSlot * 2)}) : <code className="font-mono font-bold">{mtnPreview2}</code>
              </span>
            </div>
          )}
        </div>
      </div>

      <p className="text-[11px] text-on-surface-variant italic">
        💡 {t("fallbackAmountHint")}
      </p>

      {error && <p className="text-xs text-error font-medium">{error}</p>}
      {savedMsg && <p className="text-xs text-emerald-700 font-semibold">{savedMsg}</p>}

      <button
        type="submit"
        disabled={saving}
        className="py-2.5 px-5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 active:scale-95 transition-all disabled:opacity-60 self-start cursor-pointer"
      >
        {saving ? t("savingEllipsis") : t("saveChanges")}
      </button>
    </form>
  );
}
