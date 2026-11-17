"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import type { Lang } from "@/lib/i18n/translations";

export function DeleteAccountCard({ lang }: { lang: Lang }) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (confirmText.trim() !== "SUPPRIMER") {
      setError("Veuillez taper exactement SUPPRIMER pour confirmer.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/profile/delete-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "SUPPRIMER" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Impossible de supprimer le compte.");
        return;
      }
      await signOut({ callbackUrl: "/login" });
    } catch {
      setError("Erreur réseau. Veuillez réessayer.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="w-full rounded-xl bg-white border border-red-200/80 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="material-symbols-outlined text-red-600">delete_forever</span>
          <div>
            <p className="text-xs sm:text-sm font-bold text-red-900">
              {lang === "fr" ? "Supprimer mon compte" : "Delete My Account"}
            </p>
            <p className="text-[11px] text-slate-500">
              {lang === "fr"
                ? "Clôture définitive de l'accès (norme Apple App Store / RGPD)."
                : "Permanent account closure (Apple App Store / GDPR compliant)."}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen((p) => !p)}
          className="px-3 py-1.5 rounded-lg border border-red-200 text-red-700 text-xs font-bold hover:bg-red-50 cursor-pointer"
        >
          {open ? (lang === "fr" ? "Fermer" : "Close") : lang === "fr" ? "Options" : "Options"}
        </button>
      </div>

      {open && (
        <form onSubmit={handleDelete} className="pt-2 border-t border-red-100 flex flex-col gap-3">
          <p className="text-xs text-red-800 leading-relaxed">
            {lang === "fr"
              ? "Attention : cette action désactive définitivement votre accès. Votre solde portefeuille doit être à 0 FCFA et vous ne devez avoir aucun prêt ou amende impayée. Tapez SUPPRIMER pour confirmer :"
              : "Warning: this permanently closes your login access. Your wallet balance must be 0 FCFA and all loans/fines settled. Type SUPPRIMER to confirm:"}
          </p>

          {error && (
            <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 font-semibold">
              {error}
            </div>
          )}

          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="SUPPRIMER"
            className="w-full border border-red-200 rounded-lg px-3 py-2 text-xs font-mono font-bold text-red-900 bg-red-50/30"
          />
          <button
            type="submit"
            disabled={submitting || confirmText.trim() !== "SUPPRIMER"}
            className="w-full py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold text-xs cursor-pointer disabled:opacity-50"
          >
            {submitting
              ? lang === "fr"
                ? "Clôture en cours..."
                : "Closing..."
              : lang === "fr"
                ? "Confirmer la suppression définitive"
                : "Confirm Permanent Deletion"}
          </button>
        </form>
      )}
    </div>
  );
}

