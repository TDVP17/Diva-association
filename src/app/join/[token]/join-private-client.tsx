"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatXAF } from "@/lib/format-currency";
import { LoadingSpinner } from "@/components/loading-spinner";

interface JoinPrivateClientProps {
  token: string;
  tontine: {
    id: string;
    title: string;
    description: string | null;
    typeLabel: string;
    amount: number;
    fee: number;
    startDate: string;
    limitTime: string;
    maxSlots: number | null;
    creatorName: string;
    approvedMembersCount: number;
    isClosed: boolean;
    isPaused: boolean;
    isLocked: boolean;
    myMembershipStatus: string | null;
  };
  isSignedIn: boolean;
}

export function JoinPrivateClient({ token, tontine, isSignedIn }: JoinPrivateClientProps) {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(tontine.myMembershipStatus);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  async function handleJoin() {
    if (!isSignedIn) {
      router.push(`/login?callbackUrl=${encodeURIComponent(`/join/${token}`)}`);
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(`/api/private-tontines/join/${encodeURIComponent(token)}`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Impossible d'envoyer votre demande.");
        return;
      }
      if (data.alreadyMember) {
        router.push(`/sessions/${tontine.id}`);
        return;
      }
      setStatus("PENDING");
      setSuccessMsg(data.message || "Demande d'adhésion envoyée avec succès !");
    } catch {
      setError("Erreur réseau. Veuillez réessayer.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#06291e] via-[#0b3d2e] to-[#0f513c] flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-2xl overflow-hidden border border-emerald-900/10">
        {/* Header */}
        <div className="bg-[#0b3d2e] text-white p-6 text-center relative">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-400/20 border border-amber-300/30 text-amber-200 text-xs font-bold mb-3">
            <span className="material-symbols-outlined text-[15px]">lock</span>
            <span>Invitation Cotisation Privée</span>
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight">{tontine.title}</h1>
          <p className="text-xs text-emerald-200 mt-1">
            Organisée par <strong className="text-white">{tontine.creatorName}</strong> sur DIVA Asso
          </p>
        </div>

        {/* Body */}
        <div className="p-6 flex flex-col gap-5">
          {tontine.description && (
            <p className="text-sm text-slate-600 bg-slate-50 p-3.5 rounded-2xl border border-slate-100 leading-relaxed">
              {tontine.description}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="p-3.5 rounded-2xl bg-emerald-50/70 border border-emerald-100">
              <span className="text-[11px] font-bold text-emerald-700 uppercase">Mise unitaire</span>
              <p className="text-lg font-extrabold text-emerald-950 mt-0.5">{formatXAF(tontine.amount)}</p>
            </div>
            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/70">
              <span className="text-[11px] font-bold text-slate-500 uppercase">Fréquence</span>
              <p className="text-sm font-bold text-slate-900 mt-1">{tontine.typeLabel}</p>
            </div>
            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/70">
              <span className="text-[11px] font-bold text-slate-500 uppercase">Début</span>
              <p className="text-sm font-bold text-slate-900 mt-1">
                {new Date(tontine.startDate).toLocaleDateString("fr-FR", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </p>
            </div>
            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/70">
              <span className="text-[11px] font-bold text-slate-500 uppercase">Membres</span>
              <p className="text-sm font-bold text-slate-900 mt-1">
                {tontine.approvedMembersCount}
                {tontine.maxSlots ? ` / ${tontine.maxSlots}` : " inscrits"}
              </p>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200/70 text-[11px] text-amber-900 flex items-start gap-2">
            <span className="material-symbols-outlined text-amber-700 text-[18px] flex-shrink-0">info</span>
            <span>
              Cette tontine est un <strong>cercle privé confidentiel</strong> (invisible publiquement). Seul le gestionnaire peut valider votre entrée.
            </span>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-medium">
              {error}
            </div>
          )}

          {successMsg && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-medium flex items-center gap-2">
              <span className="material-symbols-outlined text-emerald-700 text-[18px]">check_circle</span>
              <span>{successMsg}</span>
            </div>
          )}

          {status === "APPROVED" ? (
            <Link
              href={`/sessions/${tontine.id}`}
              className="w-full py-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-sm text-center transition-all shadow-md"
            >
              Ouvrir cette tontine
            </Link>
          ) : status === "PENDING" ? (
            <div className="flex flex-col gap-2">
              <div className="w-full py-3 px-4 rounded-xl bg-amber-100 text-amber-900 font-bold text-sm text-center">
                ⏳ Demande en attente de validation
              </div>
              <Link
                href="/sessions"
                className="text-center text-xs text-slate-500 hover:underline font-medium"
              >
                Retourner à mes cotisations
              </Link>
            </div>
          ) : tontine.isClosed || tontine.isLocked || tontine.isPaused ? (
            <div className="w-full py-3 px-4 rounded-xl bg-slate-100 text-slate-600 font-bold text-sm text-center">
              Les inscriptions sont actuellement fermées
            </div>
          ) : (
            <button
              type="button"
              onClick={handleJoin}
              disabled={submitting}
              className="w-full py-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 active:scale-[0.98] text-white font-bold text-sm transition-all shadow-md cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <LoadingSpinner />
                  <span>Envoi de la demande...</span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[20px]">group_add</span>
                  <span>
                    {isSignedIn
                      ? "Demander à rejoindre cette tontine"
                      : "Se connecter pour rejoindre"}
                  </span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

