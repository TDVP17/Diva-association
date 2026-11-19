"use client";

import { useState } from "react";
import { formatXAF } from "@/lib/format-currency";
import { LoadingSpinner } from "@/components/loading-spinner";

export interface AdminLoanRow {
  id: string;
  principal: number;
  interestAmount: number;
  penaltyAmount: number;
  totalDue: number;
  totalPaid: number;
  remainingDue: number;
  status: string;
  requiresAdminApproval?: boolean;
  rejectionReason?: string | null;
  dueDate: string;
  graceEndDate: string;
  repaidAt: string | null;
  createdAt: string;
  guaranteeSlotLabel: string | null;
  user: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    stars: number;
    memberCode: string | null;
  };
}

export interface AdminLoanStats {
  pendingAdminCount: number;
  activeCount: number;
  overdueCount: number;
  repaidCount: number;
  totalPrincipalLent: number;
  totalOutstanding: number;
  totalInterestAndPenaltiesEarned: number;
}

export function AdminLoansClient({
  initialStats,
  initialLoans,
}: {
  initialStats: AdminLoanStats;
  initialLoans: AdminLoanRow[];
}) {
  const [stats, setStats] = useState(initialStats);
  const [loans, setLoans] = useState(initialLoans);
  const [sweeping, setSweeping] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refreshList() {
    const listRes = await fetch("/api/admin/loans");
    if (listRes.ok) {
      const listData = await listRes.json();
      setStats(listData.stats);
      setLoans(listData.loans);
    }
  }

  async function runSweep() {
    setSweeping(true);
    setFeedback(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/loans", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setFeedback(
          `Recalcul terminé : ${data.scanned} prêt(s) analysé(s), ${data.updatedCount} pénalité(s) appliquée(s), ${data.notifiedCount} alerte(s) envoyée(s).`,
        );
        await refreshList();
      }
    } finally {
      setSweeping(false);
    }
  }

  async function handleDecision(id: string, decision: "APPROVE" | "REJECT" | "CANCEL_REVERT") {
    let reason: string | undefined;
    if (decision === "REJECT") {
      const input = window.prompt("Motif du refus (optionnel) :", "Garantie insuffisante ou plafond dépassé");
      if (input === null) return;
      reason = input;
    } else if (decision === "CANCEL_REVERT") {
      const confirmed = window.confirm(
        "Annuler ce prêt et retirer son capital du portefeuille du membre ?",
      );
      if (!confirmed) return;
      reason = "Annulé par l'administrateur";
    }

    setBusyId(id);
    setFeedback(null);
    setError(null);
    try {
      const res = await fetch(`/api/admin/loans/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erreur lors du traitement.");
        return;
      }
      setFeedback(data.message || "Action effectuée avec succès.");
      await refreshList();
    } catch {
      setError("Erreur réseau.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string) {
    const confirmed = window.confirm(
      "Supprimer définitivement ce prêt ? (S'il est actif, le capital disponible dans le portefeuille sera retiré.)",
    );
    if (!confirmed) return;

    setBusyId(id);
    setFeedback(null);
    setError(null);
    try {
      const res = await fetch(`/api/admin/loans/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erreur lors de la suppression.");
        return;
      }
      setFeedback(data.message || "Prêt supprimé définitivement.");
      await refreshList();
    } catch {
      setError("Erreur réseau.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="px-container-padding py-stack-gap-lg max-w-6xl mx-auto w-full flex flex-col gap-6 pb-24">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">Gestion des Prêts d&apos;Urgence</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            ≤ 140 000 FCFA : automatique selon éligibilité · &gt; 140 000 FCFA : validation Admin obligatoire avant crédit du portefeuille.
          </p>
        </div>

        <button
          type="button"
          onClick={runSweep}
          disabled={sweeping}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-white font-bold text-xs hover:opacity-90 cursor-pointer disabled:opacity-50"
        >
          {sweeping ? <LoadingSpinner /> : <span className="material-symbols-outlined text-[18px]">sync</span>}
          <span>Recalculer les pénalités de retard</span>
        </button>
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

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <div className="bg-white rounded-2xl p-4 border border-slate-200/80">
          <span className="text-[11px] font-bold text-slate-500 uppercase">Capital prêté</span>
          <p className="text-xl font-extrabold text-slate-900 mt-1">{formatXAF(stats.totalPrincipalLent)}</p>
        </div>
        <div className="bg-amber-50 rounded-2xl p-4 border border-amber-200">
          <span className="text-[11px] font-bold text-amber-800 uppercase">En attente Admin</span>
          <p className="text-2xl font-extrabold text-amber-900 mt-1">{stats.pendingAdminCount}</p>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-slate-200/80">
          <span className="text-[11px] font-bold text-slate-500 uppercase">Prêts actifs</span>
          <p className="text-2xl font-extrabold text-emerald-800 mt-1">{stats.activeCount}</p>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-red-200">
          <span className="text-[11px] font-bold text-red-600 uppercase">Prêts en retard</span>
          <p className="text-2xl font-extrabold text-red-600 mt-1">{stats.overdueCount}</p>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-slate-200/80">
          <span className="text-[11px] font-bold text-slate-500 uppercase">Encours restant</span>
          <p className="text-xl font-extrabold text-slate-900 mt-1">{formatXAF(stats.totalOutstanding)}</p>
        </div>
        <div className="bg-[#0b3d2e] rounded-2xl p-4 text-white">
          <span className="text-[11px] font-bold text-emerald-200 uppercase">Intérêts & Pénalités</span>
          <p className="text-xl font-extrabold mt-1">{formatXAF(stats.totalInterestAndPenaltiesEarned)}</p>
        </div>
      </div>

      {/* Loans List */}
      {loans.length === 0 ? (
        <div className="bg-white rounded-3xl p-10 text-center border border-slate-200">
          <p className="text-sm font-bold text-slate-600">Aucun prêt d&apos;urgence émis pour le moment.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {loans.map((l) => (
            <div
              key={l.id}
              className={`rounded-2xl p-4 sm:p-5 border flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                l.status === "PENDING_ADMIN"
                  ? "bg-amber-50/50 border-amber-300"
                  : "bg-white border-slate-200/80"
              }`}
            >
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-extrabold text-slate-900">
                    {l.user.name} {l.user.memberCode ? `(${l.user.memberCode})` : ""}
                  </span>
                  <span className="text-xs text-amber-600 font-bold">⭐ {l.user.stars}/5</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                      l.status === "PENDING_ADMIN"
                        ? "bg-amber-200 text-amber-950"
                        : l.status === "REPAID" || l.status === "DEDUCTED_FROM_POT"
                          ? "bg-emerald-100 text-emerald-800"
                          : l.status === "REJECTED"
                            ? "bg-slate-200 text-slate-700"
                            : l.status === "OVERDUE"
                              ? "bg-red-100 text-red-700"
                              : "bg-blue-100 text-blue-800"
                    }`}
                  >
                    {l.status === "PENDING_ADMIN"
                      ? "En attente validation Admin"
                      : l.status === "REJECTED"
                        ? "Refusé / Annulé"
                        : l.status === "DEDUCTED_FROM_POT"
                          ? "Prélevé sur cagnotte"
                          : l.status === "REPAID"
                            ? "Remboursé"
                            : l.status === "OVERDUE"
                              ? "En retard"
                              : "Actif"}
                  </span>
                </div>
                <p className="text-xs text-slate-600">
                  Capital : <strong>{formatXAF(l.principal)}</strong> · Intérêts :{" "}
                  <strong>{formatXAF(l.interestAmount)}</strong> · Pénalités :{" "}
                  <strong className={l.penaltyAmount > 0 ? "text-red-600" : ""}>
                    {formatXAF(l.penaltyAmount)}
                  </strong>
                </p>
                <p className="text-[11px] text-slate-400">
                  Demandé le {new Date(l.createdAt).toLocaleDateString("fr-FR")} · Échéance :{" "}
                  {new Date(l.dueDate).toLocaleDateString("fr-FR")}
                  {l.guaranteeSlotLabel ? ` · Garantie : ${l.guaranteeSlotLabel}` : ""}
                </p>
                {l.rejectionReason && (
                  <p className="text-[11px] text-red-600 font-medium">Note : {l.rejectionReason}</p>
                )}
              </div>

              <div className="flex flex-col sm:items-end gap-2">
                <div className="sm:text-right">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">
                    {l.status === "PENDING_ADMIN" ? "Montant demandé" : "Reste dû"}
                  </span>
                  <span className="text-base font-extrabold text-slate-900">
                    {formatXAF(l.status === "PENDING_ADMIN" ? l.principal : l.remainingDue)}
                  </span>
                </div>

                {l.status === "PENDING_ADMIN" && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={busyId === l.id}
                      onClick={() => handleDecision(l.id, "APPROVE")}
                      className="px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs cursor-pointer disabled:opacity-50"
                    >
                      Approuver & Créditer
                    </button>
                    <button
                      type="button"
                      disabled={busyId === l.id}
                      onClick={() => handleDecision(l.id, "REJECT")}
                      className="px-3.5 py-2 rounded-xl bg-red-50 border border-red-200 text-red-700 font-bold text-xs hover:bg-red-100 cursor-pointer disabled:opacity-50"
                    >
                      Refuser
                    </button>
                  </div>
                )}

                <div className="flex items-center gap-2 flex-wrap justify-end">
                  {(l.status === "ACTIVE" || l.status === "OVERDUE") && (
                    <button
                      type="button"
                      disabled={busyId === l.id}
                      onClick={() => handleDecision(l.id, "CANCEL_REVERT")}
                      className="px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 font-bold text-[11px] hover:bg-amber-100 cursor-pointer disabled:opacity-50"
                    >
                      Annuler & Retirer
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busyId === l.id}
                    onClick={() => handleDelete(l.id)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold text-[11px] cursor-pointer disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-[14px]">delete</span>
                    <span>Supprimer</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
