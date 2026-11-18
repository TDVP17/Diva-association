"use client";

import { useState } from "react";
import type { Lang } from "@/lib/i18n/translations";

export function PrivateRulesEditor({
  initialContent,
  lang,
}: {
  initialContent: string;
  lang: Lang;
}) {
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSavedMsg(null);
    setError(null);
    try {
      const res = await fetch("/api/private-tontines/rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erreur lors de l'enregistrement.");
        return;
      }
      setSavedMsg(
        lang === "fr"
          ? "Règles des cotisations privées enregistrées avec succès !"
          : "Private cotisation rules saved successfully!",
      );
    } catch {
      setError("Erreur réseau.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-3">
      <p className="text-xs text-slate-500">
        {lang === "fr"
          ? "Ces règles doivent obligatoirement être lues et acceptées par tout membre avant qu'il ne puisse créer une cotisation privée."
          : "These rules must be read and accepted by every user before they can create a private cotisation."}
      </p>
      <textarea
        rows={10}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="w-full rounded-xl border-2 border-emerald-600/60 focus:border-emerald-700 focus:outline-none p-3 text-xs leading-relaxed text-slate-800 bg-slate-50 focus:bg-white"
      />
      {error && <p className="text-xs text-red-600 font-semibold">{error}</p>}
      {savedMsg && <p className="text-xs text-emerald-700 font-semibold">{savedMsg}</p>}
      <button
        type="submit"
        disabled={saving}
        className="self-end px-4 py-2 rounded-xl bg-primary text-on-primary font-bold text-xs hover:opacity-90 cursor-pointer disabled:opacity-50"
      >
        {saving
          ? lang === "fr"
            ? "Enregistrement..."
            : "Saving..."
          : lang === "fr"
            ? "Enregistrer les règles privées"
            : "Save Private Rules"}
      </button>
    </form>
  );
}

