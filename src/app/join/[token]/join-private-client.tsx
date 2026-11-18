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
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  async function handleJoin() {
    if (!isSignedIn) {
      router.push(`/login?callbackUrl=${encodeURIComponent(`/join/${token}`)}`);
      return;
    }
    if (!disclaimerAccepted) {
      setError("Vous devez lire et cocher l'acceptation de la clause de non-responsabilité DIVA Asso avant de pouvoir demander l'intégration.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(`/api/private-tontines/join/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disclaimerAccepted: true }),
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

          {/* Disclaimer légal obligatoire (Section 10) */}
          <div className="rounded-2xl border-2 border-amber-300 bg-amber-50/60 p-3.5 flex flex-col gap-2.5">
            <div className="flex items-center gap-1.5 text-amber-950 font-bold text-xs uppercase">
              <span className="material-symbols-outlined text-[17px] text-amber-700">gavel</span>
              <span>Clause de non-responsabilité DIVA Asso</span>
            </div>
            <p className="text-[11px] text-slate-700 leading-relaxed bg-white border border-amber-200 rounded-xl p-2.5">
              « DIVA Asso est une plateforme qui fournit des outils de gestion de cotisations. Les accords financiers, engagements et arrangements au sein de cette cotisation privée sont établis exclusivement entre le créateur et ses participants. DIVA Asso n&apos;est pas responsable des litiges, désaccords ou arrangements privés entre participants. »
            </p>
            {isSignedIn && status !== "APPROVED" && status !== "PENDING" && (
              <label className="flex items-start gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={disclaimerAccepted}
                  onChange={(e) => setDisclaimerAccepted(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-emerald-700 rounded cursor-pointer flex-shrink-0"
                />
                <span className="text-xs font-bold text-slate-900">
                  J&apos;ai lu et j&apos;accepte expressément cette clause de non-responsabilité avant de rejoindre.
                </span>
              </label>
            )}
          </div>

          {!isSignedIn && (
            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-950 flex items-start gap-2.5">
              <span className="material-symbols-outlined text-emerald-700 text-[18px] flex-shrink-0">person_check</span>
              <span>
                <strong>Compte DIVA Asso obligatoire :</strong> vous devez créer un compte (ou vous connecter) sur l&apos;application DIVA Asso avant de pouvoir accepter d&apos;intégrer cette cotisation privée.
              </span>
            </div>
          )}

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
              Ouvrir cette cotisation
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
          ) : !isSignedIn ? (
            <div className="flex flex-col gap-2.5">
              <Link
                href={`/login?mode=signup&callbackUrl=${encodeURIComponent(`/join/${token}`)}`}
                className="w-full py-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 active:scale-[0.98] text-white font-bold text-sm text-center transition-all shadow-md flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-[20px]">person_add</span>
                <span>Créer un compte pour intégrer</span>
              </Link>
              <Link
                href={`/login?callbackUrl=${encodeURIComponent(`/join/${token}`)}`}
                className="w-full py-3 rounded-xl bg-white border-2 border-emerald-600 text-emerald-800 hover:bg-emerald-50 font-bold text-sm text-center transition-all"
              >
                J&apos;ai déjà un compte · Se connecter
              </Link>
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
                  <span>Accepter et demander à intégrer cette cotisation</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

