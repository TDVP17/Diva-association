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
  creatorParticipates: boolean;
  privateMinParticipants: number | null;
  privateAdditionalFeePayoutPct: number;
  privatePenaltyBeneficiaryPct: number;
  emergencyFundName: string | null;
  emergencyFundMinAmount: number | null;
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
  creatorFullName?: string | null;
  creatorPhotoUrl?: string | null;
  creatorIdDocUrl?: string | null;
  guarantorId?: string | null;
  guarantorName?: string | null;
  guarantorPhone?: string | null;
  guarantorPublicSession?: string | null;
  guarantorStatus?: string | null;
  guarantorRespondedAt?: string | null;
  guarantorDeclineReason?: string | null;
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

  async function handleDelete(id: string) {
    if (!window.confirm("Supprimer cette cotisation privée de l'interface active ? (Les historiques financiers resteront conservés pour audit).")) return;
    setBusyId(id);
    setFeedback(null);
    setError(null);
    try {
      const res = await fetch(`/api/admin/private-tontines/${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Impossible de supprimer la cotisation.");
        return;
      }
      setFeedback(data.message || "Cotisation supprimée de l'interface active.");
      await refresh();
    } catch {
      setError("Erreur réseau lors de la suppression.");
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
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        t.creatorParticipates
                          ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {t.creatorParticipates ? "Créateur participant" : "Gestionnaire seul"}
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
                      Frais plateforme (5.1%) :{" "}
                      <strong className="text-emerald-800">
                        {formatXAF(Math.round(t.amount * (t.maxSlots || 10) * 0.051))}
                      </strong>
                    </span>
                    <span>
                      Démarrage :{" "}
                      <strong className="text-slate-900">
                        {new Date(t.startDate).toLocaleDateString("fr-FR")}
                      </strong>{" "}
                      ({t.limitTime})
                    </span>
                    <span>
                      Membres : <strong className="text-slate-900">{t.approvedMembersCount}</strong>
                      {t.maxSlots ? ` / ${t.maxSlots}` : ""}
                      {t.privateMinParticipants ? ` (min ${t.privateMinParticipants})` : ""}
                    </span>
                  </div>

                  {t.emergencyFundName && (
                    <p className="text-xs text-amber-900 mt-1 font-semibold">
                      🚑 {t.emergencyFundName} (min {formatXAF(t.emergencyFundMinAmount || 1000)})
                    </p>
                  )}

                  {t.creator && (
                    <p className="text-[11px] text-slate-500 mt-1.5">
                      Créateur : <strong className="text-slate-800">{t.creator.name}</strong> ({t.creator.email}
                      {t.creator.phone ? ` · ${t.creator.phone}` : ""})
                    </p>
                  )}

                  {/* KYC Créateur & Cautionnement Garant */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 pt-3 border-t border-slate-200/80">
                    {/* KYC Créateur */}
                    <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 text-xs flex flex-col gap-1.5">
                      <div className="flex items-center gap-1.5 text-slate-800 font-bold">
                        <span className="material-symbols-outlined text-[16px] text-emerald-700">badge</span>
                        <span>Identité du créateur (KYC)</span>
                      </div>
                      <p className="text-slate-600">
                        Nom complet : <strong className="text-slate-900">{t.creatorFullName || t.creator?.name || "Non renseigné"}</strong>
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        {t.creatorPhotoUrl ? (
                          <a
                            href={t.creatorPhotoUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-100 text-emerald-900 font-bold text-[10px] hover:bg-emerald-200"
                          >
                            <span className="material-symbols-outlined text-[14px]">account_box</span>
                            <span>Photo portrait ↗</span>
                          </a>
                        ) : (
                          <span className="text-[10px] text-amber-700 font-medium">⚠️ Pas de photo</span>
                        )}
                        {t.creatorIdDocUrl ? (
                          <a
                            href={t.creatorIdDocUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-100 text-blue-900 font-bold text-[10px] hover:bg-blue-200"
                          >
                            <span className="material-symbols-outlined text-[14px]">description</span>
                            <span>Pièce CNI / Doc ↗</span>
                          </a>
                        ) : (
                          <span className="text-[10px] text-amber-700 font-medium">⚠️ Pas de CNI</span>
                        )}
                      </div>
                    </div>

                    {/* Cautionnement Garant */}
                    <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 text-xs flex flex-col gap-1.5">
                      <div className="flex items-center gap-1.5 text-slate-800 font-bold">
                        <span className="material-symbols-outlined text-[16px] text-emerald-700">security</span>
                        <span>Garant désigné</span>
                      </div>
                      {t.guarantorId ? (
                        <>
                          <p className="text-slate-600">
                            Nom : <strong className="text-slate-900">{t.guarantorName || "Garant"}</strong>
                            {t.guarantorPhone ? ` · ${t.guarantorPhone}` : ""}
                          </p>
                          {t.guarantorPublicSession && (
                            <p className="text-[10px] text-slate-500">
                              Membre en cotisation publique : <em>{t.guarantorPublicSession}</em>
                            </p>
                          )}
                          <div className="mt-1">
                            {t.guarantorStatus === "ACCEPTED" ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 font-bold text-[10px]">
                                <span className="material-symbols-outlined text-[12px]">check</span>
                                <span>Cautionnement accepté par le garant</span>
                              </span>
                            ) : t.guarantorStatus === "REJECTED" ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-900 font-bold text-[10px]">
                                <span className="material-symbols-outlined text-[12px]">close</span>
                                <span>Cautionnement refusé par le garant</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-950 font-bold text-[10px]">
                                <span className="material-symbols-outlined text-[12px]">hourglass_top</span>
                                <span>En attente de l&apos;accord du garant</span>
                              </span>
                            )}
                          </div>
                        </>
                      ) : (
                        <p className="text-[11px] text-slate-500">Aucun garant désigné.</p>
                      )}
                    </div>
                  </div>

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
                    <div className="flex flex-col items-end gap-1">
                      <button
                        type="button"
                        disabled={busyId === t.id || (Boolean(t.guarantorId) && t.guarantorStatus !== "ACCEPTED")}
                        onClick={() => decide(t.id, "APPROVE")}
                        className="px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                        title={
                          t.guarantorId && t.guarantorStatus !== "ACCEPTED"
                            ? "Validation bloquée : le garant n'a pas encore accepté"
                            : "Approuver et générer le lien"
                        }
                      >
                        {busyId === t.id ? (
                          <LoadingSpinner />
                        ) : (
                          <span className="material-symbols-outlined text-[16px]">check_circle</span>
                        )}
                        <span>Valider &amp; Générer le lien</span>
                      </button>
                      {t.guarantorId && t.guarantorStatus !== "ACCEPTED" && (
                        <span className="text-[10px] text-amber-700 font-bold">
                          Accord du garant requis
                        </span>
                      )}
                    </div>
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
                  <button
                    type="button"
                    disabled={busyId === t.id}
                    onClick={() => handleDelete(t.id)}
                    className="p-2 rounded-xl bg-slate-100 hover:bg-red-100 text-slate-500 hover:text-red-700 transition-colors cursor-pointer"
                    title="Supprimer la cotisation"
                  >
                    <span className="material-symbols-outlined text-[18px]">delete</span>
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
