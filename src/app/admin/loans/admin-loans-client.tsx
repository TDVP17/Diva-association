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
  const [feedback, setFeedback] = useState<string | null>(null);

  async function runSweep() {
    setSweeping(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/loans", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setFeedback(
          `Recalcul terminé : ${data.scanned} prêt(s) analysé(s), ${data.updatedCount} pénalité(s) appliquée(s), ${data.notifiedCount} alerte(s) envoyée(s).`,
        );
        const listRes = await fetch("/api/admin/loans");
        if (listRes.ok) {
          const listData = await listRes.json();
          setStats(listData.stats);
          setLoans(listData.loans);
        }
      }
    } finally {
      setSweeping(false);
    }
  }

  return (
    <main className="px-container-padding py-stack-gap-lg max-w-6xl mx-auto w-full flex flex-col gap-6 pb-24">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">Gestion des Prêts d&apos;Urgence</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Suivi temps réel des prêts 4 étoiles, intérêts (15 %), pénalités (+5 % / 2j dès J+23) et prélèvements à la source.
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

      {feedback && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 font-semibold">
          {feedback}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl p-4 border border-slate-200/80">
          <span className="text-[11px] font-bold text-slate-500 uppercase">Prêts actifs</span>
          <p className="text-2xl font-extrabold text-emerald-800 mt-1">{stats.activeCount}</p>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-red-200">
          <span className="text-[11px] font-bold text-red-600 uppercase">Prêts en retard</span>
          <p className="text-2xl font-extrabold text-red-600 mt-1">{stats.overdueCount}</p>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-slate-200/80">
          <span className="text-[11px] font-bold text-slate-500 uppercase">Encours total dû</span>
          <p className="text-xl font-extrabold text-slate-900 mt-1">{formatXAF(stats.totalOutstanding)}</p>
        </div>
        <div className="bg-[#0b3d2e] rounded-2xl p-4 text-white">
          <span className="text-[11px] font-bold text-emerald-200 uppercase">Intérêts & Pénalités gagnés</span>
          <p className="text-xl font-extrabold mt-1">{formatXAF(stats.totalInterestAndPenaltiesEarned)}</p>
        </div>
      </div>

      {/* Loans Table */}
      {loans.length === 0 ? (
        <div className="bg-white rounded-3xl p-10 text-center border border-slate-200">
          <p className="text-sm font-bold text-slate-600">Aucun prêt d&apos;urgence émis pour le moment.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {loans.map((l) => (
            <div
              key={l.id}
              className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-extrabold text-slate-900">
                    {l.user.name} {l.user.memberCode ? `(${l.user.memberCode})` : ""}
                  </span>
                  <span className="text-xs text-amber-600 font-bold">⭐ {l.user.stars}/5</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                      l.status === "REPAID" || l.status === "DEDUCTED_FROM_POT"
                        ? "bg-emerald-100 text-emerald-800"
                        : l.status === "OVERDUE"
                          ? "bg-red-100 text-red-700"
                          : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {l.status === "DEDUCTED_FROM_POT"
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
                  Échéance : {new Date(l.dueDate).toLocaleDateString("fr-FR")}
                  {l.guaranteeSlotLabel ? ` · Garantie : ${l.guaranteeSlotLabel}` : ""}
                </p>
              </div>

              <div className="text-right">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Reste dû</span>
                <span className="text-base font-extrabold text-slate-900">
                  {formatXAF(l.remainingDue)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

