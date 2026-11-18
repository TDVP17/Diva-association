"use client";

import { useState } from "react";
import { LoadingSpinner } from "@/components/loading-spinner";

export interface AdminDisbursementRow {
  id: string;
  provider: "MTN" | "ORANGE";
  phone: string;
  accountName: string | null;
  status: string;
  rejectionReason: string | null;
  verifiedAt: string | null;
  createdAt: string;
  user: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    memberCode: string | null;
  };
}

export function AdminDisbursementClient({
  initialMethods,
}: {
  initialMethods: AdminDisbursementRow[];
}) {
  const [methods, setMethods] = useState<AdminDisbursementRow[]>(initialMethods);
  const [filter, setFilter] = useState<"PENDING" | "APPROVED" | "ALL">("PENDING");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/admin/disbursement-methods");
    if (res.ok) {
      const data = await res.json();
      setMethods(data.methods || []);
    }
  }

  async function decide(id: string, status: "PENDING" | "APPROVED" | "REJECTED") {
    let rejectionReason: string | undefined;
    if (status === "REJECTED") {
      const input = window.prompt("Motif du refus :", "Le nom ne correspond pas au compte Mobile Money");
      if (input === null) return;
      rejectionReason = input;
    } else if (status === "PENDING") {
      if (!window.confirm("Annuler la validation et remettre ce numéro en attente ?")) return;
    }

    setBusyId(id);
    setFeedback(null);
    setError(null);
    try {
      const res = await fetch(`/api/admin/disbursement-methods/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, rejectionReason }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erreur lors de la mise à jour.");
        return;
      }
      setFeedback(
        status === "APPROVED"
          ? "Numéro de retrait validé ! Le membre a été notifié et peut désormais retirer."
          : status === "PENDING"
            ? "Validation annulée : le numéro est repassé en attente."
            : "Numéro de retrait refusé et membre notifié.",
      );
      await refresh();
    } catch {
      setError("Erreur réseau.");
    } finally {
      setBusyId(null);
    }
  }

  async function removeMethod(id: string, phone: string) {
    if (!window.confirm(`Supprimer définitivement le numéro ${phone} ? Cette action est irréversible.`)) return;
    setBusyId(id);
    setFeedback(null);
    setError(null);
    try {
      const res = await fetch(`/api/admin/disbursement-methods/${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Impossible de supprimer ce numéro.");
        return;
      }
      setFeedback(`Numéro ${phone} supprimé avec succès.`);
      await refresh();
    } catch {
      setError("Erreur réseau.");
    } finally {
      setBusyId(null);
    }
  }

  const pendingCount = methods.filter((m) => m.status === "PENDING" || !m.status).length;
  const approvedCount = methods.filter((m) => m.status === "APPROVED").length;
  const visible =
    filter === "PENDING"
      ? methods.filter((m) => m.status === "PENDING" || !m.status)
      : filter === "APPROVED"
        ? methods.filter((m) => m.status === "APPROVED")
        : methods;

  return (
    <main className="px-container-padding py-stack-gap-lg max-w-5xl mx-auto w-full flex flex-col gap-5 pb-24">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">
            Validation des Numéros de Retrait (MTN / Orange)
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Vérifiez le nom officiel et le numéro de chaque membre avant d&apos;autoriser ses retraits automatiques.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setFilter("PENDING")}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer ${
              filter === "PENDING"
                ? "bg-amber-600 text-white"
                : "bg-white border border-slate-200 text-slate-700"
            }`}
          >
            En attente ({pendingCount})
          </button>
          <button
            type="button"
            onClick={() => setFilter("APPROVED")}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer ${
              filter === "APPROVED"
                ? "bg-emerald-700 text-white"
                : "bg-white border border-slate-200 text-slate-700"
            }`}
          >
            Validés ({approvedCount})
          </button>
          <button
            type="button"
            onClick={() => setFilter("ALL")}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer ${
              filter === "ALL"
                ? "bg-slate-900 text-white"
                : "bg-white border border-slate-200 text-slate-700"
            }`}
          >
            Tous ({methods.length})
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-semibold">
          {error}
        </div>
      )}
      {feedback && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 font-semibold">
          {feedback}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="bg-white rounded-3xl p-10 text-center border border-slate-200 flex flex-col items-center gap-2">
          <span className="material-symbols-outlined text-4xl text-slate-300">verified_user</span>
          <p className="text-sm font-bold text-slate-700">
            {filter === "PENDING"
              ? "Aucun numéro de retrait en attente de validation."
              : "Aucun numéro enregistré dans cette catégorie."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((m) => {
            const isPending = m.status === "PENDING" || !m.status;
            const isApproved = m.status === "APPROVED";
            return (
              <div
                key={m.id}
                className={`rounded-2xl p-4 sm:p-5 border flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                  isPending
                    ? "bg-amber-50/50 border-amber-300"
                    : isApproved
                      ? "bg-white border-emerald-200"
                      : "bg-red-50/30 border-red-200"
                }`}
              >
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`px-2 py-0.5 rounded font-bold text-[10px] uppercase ${
                        m.provider === "ORANGE"
                          ? "bg-orange-500 text-white"
                          : "bg-yellow-400 text-slate-950"
                      }`}
                    >
                      {m.provider === "ORANGE" ? "Orange Money" : "MTN MoMo"}
                    </span>
                    <span className="font-mono text-base font-extrabold text-slate-900">{m.phone}</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                        isApproved
                          ? "bg-emerald-100 text-emerald-800"
                          : isPending
                            ? "bg-amber-200 text-amber-950"
                            : "bg-red-100 text-red-700"
                      }`}
                    >
                      {isApproved ? "Validé" : isPending ? "En attente" : "Refusé"}
                    </span>
                  </div>
                  <p className="text-xs font-bold text-slate-800">
                    Nom sur le compte : <span className="text-emerald-900">{m.accountName || "Non renseigné"}</span>
                  </p>
                  <p className="text-xs text-slate-600">
                    Membre DIVA : <strong>{m.user.name}</strong> {m.user.memberCode ? `(${m.user.memberCode})` : ""} · {m.user.email}
                  </p>
                  {m.rejectionReason && (
                    <p className="text-[11px] text-red-600 font-medium">Motif refus : {m.rejectionReason}</p>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {!isApproved && (
                    <button
                      type="button"
                      disabled={busyId === m.id}
                      onClick={() => decide(m.id, "APPROVED")}
                      className="px-3.5 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs cursor-pointer disabled:opacity-50 flex items-center gap-1"
                    >
                      {busyId === m.id ? (
                        <LoadingSpinner />
                      ) : (
                        <span className="material-symbols-outlined text-[15px]">check_circle</span>
                      )}
                      <span>Valider</span>
                    </button>
                  )}
                  {isApproved && (
                    <button
                      type="button"
                      disabled={busyId === m.id}
                      onClick={() => decide(m.id, "PENDING")}
                      className="px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 font-bold text-xs hover:bg-amber-100 cursor-pointer disabled:opacity-50 flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-[15px]">undo</span>
                      <span>Annuler validation</span>
                    </button>
                  )}
                  {m.status !== "REJECTED" && (
                    <button
                      type="button"
                      disabled={busyId === m.id}
                      onClick={() => decide(m.id, "REJECTED")}
                      className="px-3 py-1.5 rounded-xl bg-red-50 border border-red-200 text-red-700 font-bold text-xs hover:bg-red-100 cursor-pointer disabled:opacity-50"
                    >
                      Refuser
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busyId === m.id}
                    onClick={() => removeMethod(m.id, m.phone)}
                    className="p-1.5 rounded-xl bg-slate-100 hover:bg-red-100 text-slate-500 hover:text-red-700 cursor-pointer disabled:opacity-50"
                    title="Supprimer ce numéro"
                  >
                    <span className="material-symbols-outlined text-[17px]">delete</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

