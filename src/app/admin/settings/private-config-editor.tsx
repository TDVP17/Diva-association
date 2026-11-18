"use client";

import { useState } from "react";
import { LoadingSpinner } from "@/components/loading-spinner";
import type {
  PrivateTontineActionOption,
  PrivateTontineCreationConfig,
} from "@/lib/private-tontine-config";
import type { Lang } from "@/lib/i18n/translations";

function sanitizeDigits(raw: string): string {
  const d = raw.replace(/\D/g, "");
  return d ? d.replace(/^0+(?=\d)/, "") : "";
}

export function PrivateConfigEditor({
  initialConfig,
  lang,
}: {
  initialConfig: PrivateTontineCreationConfig;
  lang: Lang;
}) {
  const [minSlots, setMinSlots] = useState(String(initialConfig.minSlots));
  const [maxSlotsLimit, setMaxSlotsLimit] = useState(String(initialConfig.maxSlotsLimit));
  const [minAmount, setMinAmount] = useState(String(initialConfig.minAmount));
  const [maxAmount, setMaxAmount] = useState(String(initialConfig.maxAmount));
  const [actions, setActions] = useState<PrivateTontineActionOption[]>(initialConfig.actions);

  const [newLabel, setNewLabel] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  function toggleAdminEnabled(key: string) {
    setActions((prev) =>
      prev.map((a) => (a.key === key ? { ...a, enabledByAdmin: !a.enabledByAdmin } : a)),
    );
  }

  function removeCustomAction(key: string) {
    setActions((prev) => prev.filter((a) => a.key !== key));
  }

  function handleAddCustomAction() {
    const label = newLabel.trim();
    if (label.length < 2) return;
    const slug =
      "custom_" +
      label
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "")
        .slice(0, 32) +
      "_" +
      Date.now().toString().slice(-3);

    setActions((prev) => [
      ...prev,
      {
        key: slug,
        label,
        description: newDesc.trim(),
        enabledByAdmin: true,
        defaultSelected: false,
      },
    ]);
    setNewLabel("");
    setNewDesc("");
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    setSaving(true);
    try {
      const res = await fetch("/api/private-tontines/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          minSlots: parseInt(minSlots, 10) || 2,
          maxSlotsLimit: parseInt(maxSlotsLimit, 10) || 100,
          minAmount: parseInt(minAmount, 10) || 1000,
          maxAmount: parseInt(maxAmount, 10) || 5000000,
          actions,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus({ type: "err", text: data.error || "Erreur lors de l'enregistrement." });
        return;
      }
      setStatus({
        type: "ok",
        text: "Paramètres et options des cotisations privées enregistrés !",
      });
    } catch {
      setStatus({ type: "err", text: "Erreur réseau." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-3.5">
      <p className="text-xs text-slate-600">
        {lang === "fr"
          ? "Définissez le nombre minimal/maximal de places, les mises autorisées, ainsi que les actions que les créateurs de cotisations privées pourront activer ou désactiver."
          : "Configure min/max slots, allowed amounts, and the selectable features creators can enable or disable for private cotisations."}
      </p>

      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className="block text-[11px] font-bold text-slate-700 mb-1">Places min</label>
          <input
            type="text"
            inputMode="numeric"
            value={minSlots}
            onChange={(e) => setMinSlots(sanitizeDigits(e.target.value))}
            className="w-full border-2 border-emerald-600 rounded-xl px-3 py-2 text-xs font-bold bg-white"
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-700 mb-1">Places max</label>
          <input
            type="text"
            inputMode="numeric"
            value={maxSlotsLimit}
            onChange={(e) => setMaxSlotsLimit(sanitizeDigits(e.target.value))}
            className="w-full border-2 border-emerald-600 rounded-xl px-3 py-2 text-xs font-bold bg-white"
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-700 mb-1">Mise min (FCFA)</label>
          <input
            type="text"
            inputMode="numeric"
            value={minAmount}
            onChange={(e) => setMinAmount(sanitizeDigits(e.target.value))}
            className="w-full border-2 border-emerald-600 rounded-xl px-3 py-2 text-xs font-bold bg-white"
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-700 mb-1">Mise max (FCFA)</label>
          <input
            type="text"
            inputMode="numeric"
            value={maxAmount}
            onChange={(e) => setMaxAmount(sanitizeDigits(e.target.value))}
            className="w-full border-2 border-emerald-600 rounded-xl px-3 py-2 text-xs font-bold bg-white"
          />
        </div>
      </div>

      {/* Actions list */}
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-bold text-slate-700 uppercase">
          Actions proposées aux créateurs ({actions.filter((a) => a.enabledByAdmin).length} actives)
        </span>
        {actions.map((act) => (
          <div
            key={act.key}
            className="flex items-start justify-between gap-2 p-2.5 rounded-xl border border-slate-200 bg-slate-50/70"
          >
            <label className="flex items-start gap-2 cursor-pointer flex-1 min-w-0">
              <input
                type="checkbox"
                checked={act.enabledByAdmin}
                onChange={() => toggleAdminEnabled(act.key)}
                className="mt-0.5 accent-emerald-700 cursor-pointer"
              />
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-900">{act.label}</p>
                {act.description && (
                  <p className="text-[11px] text-slate-500">{act.description}</p>
                )}
              </div>
            </label>
            {act.key.startsWith("custom_") && (
              <button
                type="button"
                onClick={() => removeCustomAction(act.key)}
                className="text-slate-400 hover:text-red-600 cursor-pointer p-1"
                title="Supprimer cette option"
              >
                <span className="material-symbols-outlined text-[16px]">delete</span>
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Add custom action */}
      <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50/40 flex flex-col gap-2">
        <span className="text-[11px] font-bold text-emerald-900">
          Ajouter une nouvelle action personnalisée
        </span>
        <input
          type="text"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Ex: Validation par garant obligatoire"
          className="border-2 border-emerald-600 rounded-lg px-2.5 py-1.5 text-xs bg-white"
        />
        <input
          type="text"
          value={newDesc}
          onChange={(e) => setNewDesc(e.target.value)}
          placeholder="Courte description (optionnel)"
          className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white"
        />
        <button
          type="button"
          onClick={handleAddCustomAction}
          disabled={newLabel.trim().length < 2}
          className="self-start px-3 py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-bold hover:bg-emerald-800 cursor-pointer disabled:opacity-40"
        >
          + Ajouter cette option
        </button>
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
        <span>Enregistrer la configuration des cotisations privées</span>
      </button>
    </form>
  );
}

