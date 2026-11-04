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

  const [orangeUssdCode, setOrangeUssdCode] = useState(initialConfig?.orangeUssdCode ?? "");
  const [orangeBeneficiaryName, setOrangeBeneficiaryName] = useState(
    initialConfig?.orangeBeneficiaryName ?? "",
  );
  const [mtnUssdCode, setMtnUssdCode] = useState(initialConfig?.mtnUssdCode ?? "");
  const [mtnBeneficiaryName, setMtnBeneficiaryName] = useState(
    initialConfig?.mtnBeneficiaryName ?? "",
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
        setOrangeUssdCode(data.orangeUssdCode ?? "");
        setOrangeBeneficiaryName(data.orangeBeneficiaryName ?? "");
        setMtnUssdCode(data.mtnUssdCode ?? "");
        setMtnBeneficiaryName(data.mtnBeneficiaryName ?? "");
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
          orangeUssdCode,
          orangeBeneficiaryName,
          mtnUssdCode,
          mtnBeneficiaryName,
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
    <form onSubmit={handleSave} className="flex flex-col gap-4">
      <p className="text-xs text-on-surface-variant leading-relaxed">
        {t("fallbackConfigDesc")}
      </p>

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

      <p className="text-[11px] text-on-surface-variant italic">
        💡 {t("fallbackAmountHint")}
      </p>

      {error && <p className="text-xs text-error font-medium">{error}</p>}
      {savedMsg && <p className="text-xs text-emerald-700 font-semibold">{savedMsg}</p>}

      <button
        type="submit"
        disabled={saving}
        className="py-2.5 px-5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 active:scale-95 transition-all disabled:opacity-60 self-start"
      >
        {saving ? t("savingEllipsis") : t("saveChanges")}
      </button>
    </form>
  );
}

