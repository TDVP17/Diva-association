"use client";

import { useState } from "react";
import { formatXAF } from "@/lib/format-currency";
import { LoadingSpinner } from "@/components/loading-spinner";

export interface AdminWithdrawalRow {
  id: string;
  amount: number;
  phone: string;
  provider: string;
  accountName: string;
  status: string;
  requiresAdminApproval: boolean;
  fapshiTransId: string | null;
  rejectionReason: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  createdAt: string;
  user: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    memberCode: string | null;
  };
}

export function AdminWithdrawalsClient({
  initialWithdrawals,
}: {
  initialWithdrawals: AdminWithdrawalRow[];
}) {
  const [rows, setRows] = useState<AdminWithdrawalRow[]>(initialWithdrawals);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"PENDING" | "ALL">("PENDING");

  async function refresh() {
    const res = await fetch("/api/admin/withdrawals");
    if (res.ok) {
      const data = await res.json();
      setRows(data.withdrawals || []);
    }
  }

  async function decide(id: string, decision: "APPROVE" | "REJECT", channel: "FAPSHI" | "DIRECT" = "FAPSHI") {
    let reason: string | undefined;
    if (decision === "REJECT") {
      const input = window.prompt("Motif du refus (optionnel) :", "Vérification de sécurité requise");
      if (input === null) return;
      reason = input;
    }

    setBusyId(id);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/withdrawals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, channel, reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erreur lors du traitement.");
        return;
      }
      setMessage(
        decision === "APPROVE"
          ? `Retrait approuvé et exécuté (${data.fapshiTransId}).`
          : "Retrait refusé et montant recrédité automatiquement au portefeuille du membre.",
      );
      await refresh();
    } catch {
      setError("Erreur réseau.");
    } finally {
      setBusyId(null);
    }
  }

  const pendingCount = rows.filter((r) => r.status === "PENDING_ADMIN").length;
  const visibleRows = filter === "PENDING" ? rows.filter((r) => r.status === "PENDING_ADMIN") : rows;

  return (
    <main className="px-container-padding py-stack-gap-lg max-w-5xl mx-auto w-full flex flex-col gap-5 pb-24">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">Validation des Retraits Portefeuille</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Les retraits &lt; 50 000 FCFA sont automatiques. Les retraits &ge; 50 000 FCFA nécessitent votre approbation.
          </p>
        </div>

        <div className="flex items-center gap-2">
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
            onClick={() => setFilter("ALL")}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer ${
              filter === "ALL"
                ? "bg-primary text-white"
                : "bg-white border border-slate-200 text-slate-700"
            }`}
          >
            Tout l&apos;historique ({rows.length})
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-semibold">
          {error}
        </div>
      )}
      {message && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-semibold">
          {message}
        </div>
      )}

      {visibleRows.length === 0 ? (
        <div className="bg-white rounded-3xl p-10 text-center border border-slate-200 flex flex-col items-center gap-2">
          <span className="material-symbols-outlined text-4xl text-slate-300">task_alt</span>
          <p className="text-sm font-bold text-slate-700">
            {filter === "PENDING"
              ? "Aucune demande de retrait en attente de validation."
              : "Aucun retrait enregistré pour le moment."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {visibleRows.map((w) => (
            <div
              key={w.id}
              className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/80 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-base font-extrabold text-slate-900">{formatXAF(w.amount)}</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                      w.status === "PENDING_ADMIN"
                        ? "bg-amber-100 text-amber-900"
                        : w.status === "COMPLETED" || w.status === "AUTO_PROCESSED"
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-red-100 text-red-700"
                    }`}
                  >
                    {w.status === "PENDING_ADMIN"
                      ? "En attente Admin"
                      : w.status === "COMPLETED"
                        ? "Viré"
                        : w.status === "REJECTED"
                          ? "Refusé & Remboursé"
                          : w.status}
                  </span>
                </div>
                <p className="text-xs font-bold text-slate-800">
                  {w.user.name} {w.user.memberCode ? `(${w.user.memberCode})` : ""}
                </p>
                <p className="text-xs text-slate-600">
                  Vers : <strong>{w.provider} {w.phone}</strong> · Titulaire : <strong>{w.accountName}</strong>
                </p>
                <p className="text-[11px] text-slate-400">
                  Demandé le {new Date(w.createdAt).toLocaleString("fr-FR")}
                  {w.fapshiTransId ? ` · Réf: ${w.fapshiTransId}` : ""}
                </p>
                {w.rejectionReason && (
                  <p className="text-[11px] text-red-600 font-medium">Motif : {w.rejectionReason}</p>
                )}
              </div>

              {w.status === "PENDING_ADMIN" && (
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    disabled={busyId === w.id}
                    onClick={() => decide(w.id, "APPROVE", "FAPSHI")}
                    className="px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {busyId === w.id ? <LoadingSpinner /> : <span className="material-symbols-outlined text-[16px]">send_money</span>}
                    <span>Approuver (Fapshi)</span>
                  </button>
                  <button
                    type="button"
                    disabled={busyId === w.id}
                    onClick={() => decide(w.id, "APPROVE", "DIRECT")}
                    className="px-3.5 py-2 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 font-bold text-xs hover:bg-emerald-100 cursor-pointer disabled:opacity-50"
                  >
                    Approuver (Direct)
                  </button>
                  <button
                    type="button"
                    disabled={busyId === w.id}
                    onClick={() => decide(w.id, "REJECT")}
                    className="px-3.5 py-2 rounded-xl bg-red-50 border border-red-200 text-red-700 font-bold text-xs hover:bg-red-100 cursor-pointer disabled:opacity-50"
                  >
                    Refuser
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

