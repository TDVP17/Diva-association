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
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    const minVal = parseInt(minInput, 10) || 0;
    const maxVal = parseInt(maxInput, 10) || 0;
    if (minVal < 100 || maxVal < minVal) {
      setStatus({
        type: "err",
        text: "Le minimum doit être ≥ 100 FCFA et le maximum ≥ au minimum.",
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
            ? "Plafonds de retrait globaux enregistrés !"
            : "Global withdrawal limits saved!",
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
          ? "Définissez le montant minimum et maximum de retrait pour tous les utilisateurs. Vous pouvez aussi personnaliser le maximum d'un membre spécifique dans « Tous les utilisateurs »."
          : "Set the global minimum and maximum withdrawal amounts. You can also customize an individual member's max limit in All Users."}
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-bold text-slate-700 mb-1">
            Minimum global (FCFA)
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
            Maximum global (FCFA)
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={maxInput}
            onChange={(e) => setMaxInput(sanitizeDigits(e.target.value))}
            className="w-full border-2 border-emerald-600 rounded-xl px-3 py-2 text-sm font-bold bg-white"
          />
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

