"use client";

import { useEffect, useState } from "react";
import { type Lang } from "@/lib/i18n/translations";
import { parseJsonOrThrow, friendlyErrorMessage } from "@/lib/api-error";
import { detectMobileMoneyProvider } from "@/lib/mobile-money-provider";
import { LoadingSpinner } from "@/components/loading-spinner";
import type { MobileMoneyProvider } from "@/generated/prisma/enums";

interface DisbursementMethod {
  id: string;
  provider: MobileMoneyProvider;
  label: string | null;
  phone: string;
  accountName: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  rejectionReason: string | null;
  isDefault: boolean;
}

export function SavedPaymentMethodsCard({ lang }: { lang: Lang }) {
  const [methods, setMethods] = useState<DisbursementMethod[] | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [newAccountName, setNewAccountName] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function refresh() {
    fetch("/api/profile/payment-methods")
      .then((res) => (res.ok ? res.json() : { methods: [] }))
      .then((body: { methods: DisbursementMethod[] }) => setMethods(body.methods))
      .catch(() => setMethods([]));
  }

  useEffect(() => {
    refresh();
  }, []);

  const detectedProvider = newPhone.trim()
    ? detectMobileMoneyProvider(newPhone.replace(/\D/g, "").replace(/^237/, ""))
    : null;

  async function handleAdd() {
    if (!newAccountName.trim()) {
      setError(
        lang === "fr"
          ? "Veuillez renseigner le nom complet du titulaire de ce compte (tel qu'enregistré chez l'opérateur)."
          : "Please enter the account holder's full name."
      );
      return;
    }

    setAdding(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/profile/payment-methods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: newPhone,
          accountName: newAccountName.trim().toUpperCase(),
        }),
      });
      await parseJsonOrThrow(res, lang === "fr" ? "Erreur lors de l'enregistrement" : "Error saving number");
      setNewPhone("");
      setNewAccountName("");
      setShowAddForm(false);
      setSuccess(
        lang === "fr"
          ? "Numéro de retrait enregistré ! Il est maintenant en attente de vérification par DIVA Asso."
          : "Disbursement number registered! It is now pending verification by DIVA Asso."
      );
      refresh();
    } catch (err) {
      setError(friendlyErrorMessage(err, lang === "fr" ? "Erreur lors de l'enregistrement" : "Error saving number"));
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm(lang === "fr" ? "Supprimer ce numéro de retrait ?" : "Delete this disbursement number?")) return;
    setBusyId(id);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/profile/payment-methods/${id}`, { method: "DELETE" });
      await parseJsonOrThrow(res, lang === "fr" ? "Erreur lors de la suppression" : "Error deleting number");
      refresh();
    } catch (err) {
      setError(friendlyErrorMessage(err, lang === "fr" ? "Erreur lors de la suppression" : "Error deleting number"));
    } finally {
      setBusyId(null);
    }
  }

  async function handleSetDefault(id: string) {
    setBusyId(id);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/profile/payment-methods/${id}/set-default`, { method: "POST" });
      await parseJsonOrThrow(res, lang === "fr" ? "Erreur de mise à jour" : "Error updating default");
      refresh();
    } catch (err) {
      setError(friendlyErrorMessage(err, lang === "fr" ? "Erreur de mise à jour" : "Error updating default"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="mb-stack-gap-lg bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[22px]">payments</span>
            <h2 className="font-title-md text-base sm:text-lg font-bold text-on-surface">
              {lang === "fr" ? "Numéros de retrait (Décaissement)" : "Disbursement / Payout Numbers"}
            </h2>
          </div>
        </div>
      </div>

      {methods === null ? (
        <LoadingSpinner />
      ) : (
        <div className="flex flex-col gap-3 mt-3">
          {methods.length > 0 && (
            <div className="flex flex-col gap-2.5">
              {methods.map((m) => {
                const isApproved = m.status === "APPROVED";
                const isPending = m.status === "PENDING" || !m.status;
                const isRejected = m.status === "REJECTED";

                return (
                  <div
                    key={m.id}
                    className={`flex items-center justify-between gap-2 border rounded-xl px-2.5 py-2 transition-colors ${
                      isApproved
                        ? "border-emerald-200 bg-emerald-50/30"
                        : isPending
                          ? "border-amber-200 bg-amber-50/40"
                          : "border-red-200 bg-red-50/40"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span
                        className={`px-1.5 py-0.5 rounded font-bold text-[9px] uppercase tracking-wide flex-shrink-0 ${
                          m.provider === "ORANGE" ? "bg-orange-500 text-white" : "bg-yellow-400 text-slate-950"
                        }`}
                      >
                        {m.provider === "ORANGE" ? "OM" : "MTN"}
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono text-xs font-bold text-on-surface">{m.phone}</span>
                          {isApproved && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-800 bg-emerald-100 px-1.5 py-0.2 rounded-full">
                              <span className="material-symbols-outlined text-[11px]">verified</span>
                              <span>{lang === "fr" ? "Validé" : "Verified"}</span>
                            </span>
                          )}
                          {isPending && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-900 bg-amber-100 px-1.5 py-0.2 rounded-full">
                              <span className="material-symbols-outlined text-[11px]">schedule</span>
                              <span>{lang === "fr" ? "En attente" : "Pending"}</span>
                            </span>
                          )}
                          {isRejected && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-red-800 bg-red-100 px-1.5 py-0.2 rounded-full">
                              <span>{lang === "fr" ? "Refusé" : "Rejected"}</span>
                            </span>
                          )}
                        </div>
                        {m.accountName && (
                          <p className="text-[11px] text-slate-600 truncate leading-tight mt-0.5">
                            {m.accountName}
                          </p>
                        )}
                        {isRejected && m.rejectionReason && (
                          <p className="text-[10px] text-red-700 italic truncate">{m.rejectionReason}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 flex-shrink-0">
                      {!m.isDefault && (
                        <button
                          type="button"
                          onClick={() => handleSetDefault(m.id)}
                          disabled={busyId === m.id}
                          className="text-[10px] text-primary hover:underline font-semibold cursor-pointer disabled:opacity-50 px-1"
                        >
                          {lang === "fr" ? "Défaut" : "Default"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDelete(m.id)}
                        disabled={busyId === m.id}
                        className="w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:text-error hover:bg-error/10 transition-colors cursor-pointer disabled:opacity-50"
                        title={lang === "fr" ? "Supprimer" : "Delete"}
                      >
                        <span className="material-symbols-outlined text-[16px]">
                          {busyId === m.id ? "hourglass_empty" : "delete"}
                        </span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {methods.length < 4 &&
            (showAddForm ? (
              <div className="p-3.5 border border-primary/30 rounded-xl bg-primary/5 flex flex-col gap-3 animate-in fade-in duration-200">
                <h3 className="text-xs font-bold text-primary">
                  {lang === "fr" ? "Ajouter un numéro de retrait officiel" : "Add official disbursement number"}
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      {lang === "fr" ? "Numéro (Orange ou MTN) :" : "Phone number (Orange or MTN):"}
                    </label>
                    <input
                      type="tel"
                      inputMode="tel"
                      maxLength={9}
                      autoFocus
                      value={newPhone}
                      onChange={(e) => setNewPhone(e.target.value.replace(/\D/g, "").slice(0, 9))}
                      placeholder="6XXXXXXXX"
                      className="w-full border-2 border-emerald-600 focus:border-emerald-700 focus:outline-none rounded-lg px-3 py-2 font-mono text-sm bg-white"
                    />
                    {detectedProvider && (
                      <span
                        className={`inline-block mt-1 px-2 py-0.5 rounded font-bold text-[10px] uppercase tracking-wide ${
                          detectedProvider === "ORANGE" ? "bg-orange-500 text-white" : "bg-yellow-400 text-slate-950"
                        }`}
                      >
                        {detectedProvider === "ORANGE" ? "Orange Money détecté" : "MTN MoMo détecté"}
                      </span>
                    )}
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      {lang === "fr" ? "Nom officiel du titulaire du compte :" : "Account holder official name:"}
                    </label>
                    <input
                      type="text"
                      value={newAccountName}
                      onChange={(e) => setNewAccountName(e.target.value)}
                      placeholder={lang === "fr" ? "Nom complet sur le compte" : "Full name on account"}
                      className="w-full border-2 border-emerald-600 focus:border-emerald-700 focus:outline-none rounded-lg px-3 py-2 text-sm bg-white"
                    />
                    <span className="block text-[10px] text-slate-500 mt-1">
                      {lang === "fr"
                        ? "Doit correspondre exactement au compte Mobile Money pour validation."
                        : "Must match the Mobile Money account name."}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-1 border-t border-primary/20">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddForm(false);
                      setNewPhone("");
                      setNewAccountName("");
                      setError(null);
                    }}
                    disabled={adding}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:bg-black/5 cursor-pointer"
                  >
                    {lang === "fr" ? "Annuler" : "Cancel"}
                  </button>
                  <button
                    type="button"
                    onClick={handleAdd}
                    disabled={adding || !newPhone.trim() || !newAccountName.trim()}
                    className="px-4 py-1.5 rounded-lg bg-primary text-white font-bold text-xs hover:bg-primary/90 transition-all disabled:opacity-50 cursor-pointer shadow-xs"
                  >
                    {adding ? (lang === "fr" ? "Enregistrement..." : "Saving...") : (lang === "fr" ? "Enregistrer pour validation" : "Save for verification")}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowAddForm(true)}
                className="inline-flex items-center gap-1.5 font-bold text-xs text-primary hover:underline cursor-pointer self-start"
              >
                <span className="material-symbols-outlined text-[18px]">add_circle</span>
                <span>{lang === "fr" ? "Ajouter un numéro de retrait (MTN ou Orange)" : "Add disbursement number (MTN or Orange)"}</span>
              </button>
            ))}

          {error && <p className="text-xs text-error font-medium mt-1">{error}</p>}
          {success && <p className="text-xs text-emerald-700 font-semibold mt-1">{success}</p>}
        </div>
      )}
    </section>
  );
}
