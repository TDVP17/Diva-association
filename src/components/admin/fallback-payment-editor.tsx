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

  // Suspension des opérateurs
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* SUSPENSION ORANGE MONEY */}
          <div className={`p-3.5 rounded-xl border-2 transition-all flex flex-col gap-3 ${
            isOrangeSuspended
              ? "border-red-500 bg-red-50/80 shadow-xs"
              : "border-orange-200 bg-white"
          }`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded font-bold text-[11px] bg-[#FF6600] text-white">
                  Orange Money
                </span>
                <span className="text-xs font-bold text-slate-900">
                  {lang === "fr" ? "Suspendre Orange" : "Suspend Orange"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsOrangeSuspended(!isOrangeSuspended)}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  isOrangeSuspended ? "bg-red-600" : "bg-slate-300"
                }`}
                role="switch"
                aria-checked={isOrangeSuspended}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    isOrangeSuspended ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
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
                  placeholder={
                    lang === "fr"
                      ? "Ex: Les paiements via Orange Money sont indisponibles pour le moment (Jusqu'au 25 Novembre). Veuillez payer avec MTN Mobile Money."
                      : "e.g. Orange Money payments are temporarily unavailable. Please pay with MTN Mobile Money."
                  }
                  className="w-full rounded-lg border border-red-300 bg-white p-2 text-xs text-slate-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                />
                <span className="text-[10px] text-red-700 italic">
                  {lang === "fr"
                    ? "Si le membre entre un 69X, ce message s'affiche en rouge et le paiement Orange est bloqué."
                    : "If member enters an Orange number, this message is shown and Orange payment is blocked."}
                </span>
              </div>
            )}
          </div>

          {/* SUSPENSION MTN MOBILE MONEY */}
          <div className={`p-3.5 rounded-xl border-2 transition-all flex flex-col gap-3 ${
            isMtnSuspended
              ? "border-red-500 bg-red-50/80 shadow-xs"
              : "border-amber-200 bg-white"
          }`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded font-bold text-[11px] bg-yellow-400 text-slate-950">
                  MTN MoMo
                </span>
                <span className="text-xs font-bold text-slate-900">
                  {lang === "fr" ? "Suspendre MTN" : "Suspend MTN"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsMtnSuspended(!isMtnSuspended)}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  isMtnSuspended ? "bg-red-600" : "bg-slate-300"
                }`}
                role="switch"
                aria-checked={isMtnSuspended}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    isMtnSuspended ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
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
                  placeholder={
                    lang === "fr"
                      ? "Ex: Les paiements via MTN Mobile Money sont indisponibles pour le moment. Veuillez effectuer votre paiement avec Orange Money."
                      : "e.g. MTN Mobile Money payments are temporarily unavailable. Please pay with Orange Money."
                  }
                  className="w-full rounded-lg border border-red-300 bg-white p-2 text-xs text-slate-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                />
                <span className="text-[10px] text-red-700 italic">
                  {lang === "fr"
                    ? "Si le membre entre un 67X, ce message s'affiche en rouge et le paiement MTN est bloqué."
                    : "If member enters an MTN number, this message is shown and MTN payment is blocked."}
                </span>
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
