"use client";

import { useState } from "react";
import Link from "next/link";
import { formatXAF } from "@/lib/format-currency";
import { LoadingSpinner } from "@/components/loading-spinner";

export interface AdminPrivateTontineRow {
  id: string;
  title: string;
  description: string | null;
  type: string;
  amount: number;
  fee: number;
  status: string;
  startDate: string;
  limitTime: string;
  maxSlots: number | null;
  privateApprovalStatus: string;
  privateRejectionReason: string | null;
  privateRulesAcceptedAt: string | null;
  inviteUrl: string | null;
  approvedMembersCount: number;
  creator: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    memberCode: string | null;
  } | null;
}

export function AdminPrivateTontinesClient({
  initialTontines,
}: {
  initialTontines: AdminPrivateTontineRow[];
}) {
  const [tontines, setTontines] = useState<AdminPrivateTontineRow[]>(initialTontines);
  const [filter, setFilter] = useState<"PENDING_ADMIN" | "APPROVED" | "ALL">("PENDING_ADMIN");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/admin/private-tontines");
    if (res.ok) {
      const data = await res.json();
      setTontines(data.tontines || []);
    }
  }

  async function decide(id: string, decision: "APPROVE" | "REJECT") {
    let reason: string | undefined;
    if (decision === "REJECT") {
      const input = window.prompt(
        "Motif du refus :",
        "Informations incomplètes ou non conformes aux règles DIVA Asso",
      );
      if (input === null) return;
      reason = input;
    }

    setBusyId(id);
    setFeedback(null);
    setError(null);
    try {
      const res = await fetch(`/api/admin/private-tontines/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erreur lors de la décision.");
        return;
      }
      setFeedback(
        decision === "APPROVE"
          ? "Cotisation privée validée ! Le lien d'invitation sécurisé a été généré et envoyé au créateur."
          : "Demande de cotisation privée refusée et créateur notifié.",
      );
      await refresh();
    } catch {
      setError("Erreur réseau.");
    } finally {
      setBusyId(null);
    }
  }

  const pendingCount = tontines.filter((t) => t.privateApprovalStatus === "PENDING_ADMIN").length;
  const approvedCount = tontines.filter((t) => t.privateApprovalStatus === "APPROVED").length;
  const visible =
    filter === "PENDING_ADMIN"
      ? tontines.filter((t) => t.privateApprovalStatus === "PENDING_ADMIN")
      : filter === "APPROVED"
        ? tontines.filter((t) => t.privateApprovalStatus === "APPROVED")
        : tontines;

  return (
    <main className="px-container-padding py-stack-gap-lg max-w-5xl mx-auto w-full flex flex-col gap-6 pb-24">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[11px] font-bold mb-1">
            <span className="material-symbols-outlined text-[14px]">lock</span>
            <span>Validation DIVA Asso</span>
          </span>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
            Cotisations privées ({tontines.length})
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Validez les demandes de création de cotisations privées pour générer et activer leur lien d&apos;invitation unique.
          </p>
        </div>

        <Link
          href="/admin/settings"
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-slate-200 text-slate-800 text-xs font-bold hover:bg-slate-50 self-start sm:self-center"
        >
          <span className="material-symbols-outlined text-[16px]">gavel</span>
          <span>Modifier les règles des cotisations privées</span>
        </Link>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setFilter("PENDING_ADMIN")}
          className={`px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer transition-colors ${
            filter === "PENDING_ADMIN"
              ? "bg-amber-600 text-white"
              : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
          }`}
        >
          En attente ({pendingCount})
        </button>
        <button
          type="button"
          onClick={() => setFilter("APPROVED")}
          className={`px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer transition-colors ${
            filter === "APPROVED"
              ? "bg-emerald-700 text-white"
              : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
          }`}
        >
          Validées ({approvedCount})
        </button>
        <button
          type="button"
          onClick={() => setFilter("ALL")}
          className={`px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer transition-colors ${
            filter === "ALL"
              ? "bg-slate-900 text-white"
              : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
          }`}
        >
          Toutes ({tontines.length})
        </button>
      </div>

      {feedback && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 font-semibold flex items-center gap-2">
          <span className="material-symbols-outlined text-emerald-700 text-[18px]">check_circle</span>
          <span>{feedback}</span>
        </div>
      )}

      {error && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-semibold">
          {error}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="bg-white rounded-3xl p-10 text-center border border-slate-200/80 flex flex-col items-center gap-2">
          <span className="material-symbols-outlined text-4xl text-slate-300">verified</span>
          <p className="text-sm font-bold text-slate-700">
            {filter === "PENDING_ADMIN"
              ? "Aucune cotisation privée en attente de validation."
              : "Aucune cotisation privée dans cette catégorie."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {visible.map((t) => (
            <div
              key={t.id}
              className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200/80 flex flex-col gap-3"
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                        t.privateApprovalStatus === "PENDING_ADMIN"
                          ? "bg-amber-100 text-amber-900"
                          : t.privateApprovalStatus === "APPROVED"
                            ? "bg-emerald-100 text-emerald-900"
                            : "bg-red-100 text-red-800"
                      }`}
                    >
                      {t.privateApprovalStatus === "PENDING_ADMIN"
                        ? "En attente de validation"
                        : t.privateApprovalStatus === "APPROVED"
                          ? "Validée"
                          : "Refusée"}
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[10px] font-bold">
                      {t.status}
                    </span>
                    {t.privateRulesAcceptedAt && (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 text-[10px] font-semibold">
                        ✓ Règles acceptées le{" "}
                        {new Date(t.privateRulesAcceptedAt).toLocaleDateString("fr-FR")}
                      </span>
                    )}
                  </div>

                  <h3 className="text-lg font-extrabold text-slate-900 mt-1.5">{t.title}</h3>
                  {t.description && (
                    <p className="text-xs text-slate-600 mt-0.5">{t.description}</p>
                  )}

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 mt-2">
                    <span>
                      Mise : <strong className="text-slate-900">{formatXAF(t.amount)}</strong>
                    </span>
                    <span>
                      Frais : <strong className="text-slate-900">{formatXAF(t.fee)}</strong>
                    </span>
                    <span>
                      Démarrage :{" "}
                      <strong className="text-slate-900">
                        {new Date(t.startDate).toLocaleDateString("fr-FR")}
                      </strong>{" "}
                      ({t.limitTime})
                    </span>
                    <span>
                      Membres validés : <strong className="text-slate-900">{t.approvedMembersCount}</strong>
                      {t.maxSlots ? ` / ${t.maxSlots}` : ""}
                    </span>
                  </div>

                  {t.creator && (
                    <p className="text-[11px] text-slate-500 mt-1.5">
                      Créateur : <strong className="text-slate-800">{t.creator.name}</strong> ({t.creator.email}
                      {t.creator.phone ? ` · ${t.creator.phone}` : ""})
                    </p>
                  )}

                  {t.inviteUrl && t.privateApprovalStatus === "APPROVED" && (
                    <p className="text-[11px] font-mono text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1 mt-2 break-all">
                      Lien actif : {t.inviteUrl}
                    </p>
                  )}

                  {t.privateRejectionReason && t.privateApprovalStatus === "REJECTED" && (
                    <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5 mt-2">
                      Motif du refus : {t.privateRejectionReason}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                  <Link
                    href={`/admin/sessions/${t.id}`}
                    className="px-3 py-2 rounded-xl bg-slate-100 text-slate-800 text-xs font-bold hover:bg-slate-200"
                  >
                    Voir détails
                  </Link>
                  {t.privateApprovalStatus !== "APPROVED" && (
                    <button
                      type="button"
                      disabled={busyId === t.id}
                      onClick={() => decide(t.id, "APPROVE")}
                      className="px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {busyId === t.id ? (
                        <LoadingSpinner />
                      ) : (
                        <span className="material-symbols-outlined text-[16px]">check_circle</span>
                      )}
                      <span>Valider &amp; Générer le lien</span>
                    </button>
                  )}
                  {t.privateApprovalStatus !== "REJECTED" && (
                    <button
                      type="button"
                      disabled={busyId === t.id}
                      onClick={() => decide(t.id, "REJECT")}
                      className="px-3.5 py-2 rounded-xl bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 text-xs font-bold cursor-pointer disabled:opacity-50"
                    >
                      Refuser
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
