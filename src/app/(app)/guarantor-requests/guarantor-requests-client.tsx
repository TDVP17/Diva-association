"use client";

import { useState } from "react";
import { formatXAF } from "@/lib/format-currency";
import { LoadingSpinner } from "@/components/loading-spinner";
import type { Lang } from "@/lib/i18n/translations";

export interface GuarantorRequestItem {
  id: string;
  guarantorStatus: string;
  guarantorAcceptedAt: string | null;
  guarantorDeclinedAt: string | null;
  guarantorDeclineReason: string | null;
  createdAt: string;
  applicant: {
    id: string;
    name: string;
    avatar: string | null;
    city: string | null;
    neighborhood: string | null;
  };
  tontineSession: {
    id: string;
    title: string;
    amount: number;
    fee: number;
  };
  membershipStatus: string;
}

export function GuarantorRequestsClient({
  lang,
  initialRequests,
}: {
  lang: Lang;
  initialRequests: GuarantorRequestItem[];
}) {
  const [requests, setRequests] = useState<GuarantorRequestItem[]>(initialRequests);
  const [checkedMap, setCheckedMap] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/guarantor-requests");
    if (res.ok) {
      const data = await res.json();
      setRequests(data.requests || []);
    }
  }

  async function respond(kycId: string, decision: "ACCEPTED" | "DECLINED") {
    setError(null);
    setFeedback(null);

    if (decision === "ACCEPTED" && !checkedMap[kycId]) {
      setError(
        lang === "fr"
          ? "Veuillez d'abord lire et cocher la case d'acceptation des engagements de garant."
          : "Please read and check the guarantor commitments box first.",
      );
      return;
    }

    let reason: string | undefined;
    if (decision === "DECLINED") {
      const input = window.prompt("Motif du refus (optionnel) :", "Je ne connais pas suffisamment ce membre");
      if (input === null) return;
      reason = input;
    }

    setBusyId(kycId);
    try {
      const res = await fetch(`/api/guarantor-requests/${kycId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          acceptedTerms: decision === "ACCEPTED",
          reason,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erreur lors de l'envoi de votre réponse.");
        return;
      }
      setFeedback(data.message);
      await refresh();
    } catch {
      setError("Erreur réseau. Veuillez réessayer.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="px-container-padding py-stack-gap-lg max-w-2xl mx-auto w-full flex flex-col gap-5 pb-24">
      <div>
        <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900">
          {lang === "fr" ? "Demandes de parrainage / Garant" : "Guarantor Requests"}
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          {lang === "fr"
            ? "Lorsqu'un nouveau membre vous choisit comme garant pour intégrer une cotisation, l'administrateur attend votre accord officiel avant de valider son entrée."
            : "When a new applicant designates you as guarantor, the admin waits for your official acceptance before approving their entry."}
        </p>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-semibold">
          {error}
        </div>
      )}
      {feedback && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 font-semibold flex items-center gap-2">
          <span className="material-symbols-outlined text-emerald-700 text-[18px]">check_circle</span>
          <span>{feedback}</span>
        </div>
      )}

      {requests.length === 0 ? (
        <div className="bg-white rounded-3xl p-10 text-center border border-slate-200/80 flex flex-col items-center gap-2">
          <span className="material-symbols-outlined text-4xl text-slate-300">handshake</span>
          <p className="text-sm font-bold text-slate-700">Aucune demande de garant pour le moment.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {requests.map((r) => {
            const isPending = r.guarantorStatus === "PENDING";
            const isAccepted = r.guarantorStatus === "ACCEPTED";

            return (
              <div
                key={r.id}
                className={`bg-white rounded-3xl p-5 border-2 shadow-xs flex flex-col gap-4 ${
                  isPending
                    ? "border-amber-300"
                    : isAccepted
                      ? "border-emerald-200"
                      : "border-slate-200"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {r.applicant.avatar ? (
                      <img
                        src={r.applicant.avatar}
                        alt={r.applicant.name}
                        className="w-11 h-11 rounded-full object-cover border border-slate-200"
                      />
                    ) : (
                      <div className="w-11 h-11 rounded-full bg-emerald-100 text-emerald-900 font-extrabold flex items-center justify-center">
                        {r.applicant.name.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-extrabold text-slate-900">{r.applicant.name}</p>
                      <p className="text-xs text-slate-500">
                        Cotisation : <strong className="text-slate-800">{r.tontineSession.title}</strong> ({formatXAF(r.tontineSession.amount)})
                      </p>
                      {(r.applicant.city || r.applicant.neighborhood) && (
                        <p className="text-[11px] text-slate-400">
                          {[r.applicant.city, r.applicant.neighborhood].filter(Boolean).join(", ")}
                        </p>
                      )}
                    </div>
                  </div>

                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase whitespace-nowrap ${
                      isPending
                        ? "bg-amber-100 text-amber-900"
                        : isAccepted
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-red-100 text-red-700"
                    }`}
                  >
                    {isPending ? "En attente" : isAccepted ? "Accepté" : "Refusé"}
                  </span>
                </div>

                {isPending && (
                  <>
                    {/* Conditions d'engagement du garant */}
                    <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-700 flex flex-col gap-2 leading-relaxed">
                      <p className="font-extrabold text-slate-900 uppercase text-[11px] flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-emerald-700 text-[18px]">gavel</span>
                        Engagements officiels du garant — DIVA Asso
                      </p>
                      <ul className="list-disc pl-5 flex flex-col gap-1.5">
                        <li>
                          Je certifie connaître personnellement <strong>{r.applicant.name}</strong> et atteste de son sérieux et de son honorabilité pour intégrer la cotisation <strong>{r.tontineSession.title}</strong>.
                        </li>
                        <li>
                          En cas de retard prolongé, de défaut de paiement ou de fuite après avoir perçu sa cagnotte (« bouffé »), je m&apos;engage moralement et financièrement à faciliter le recouvrement et à répondre solidairement de ses engagements vis-à-vis de DIVA Asso.
                        </li>
                        <li>
                          Je reconnais que DIVA Asso pourra retenir les sommes impayées de mon filleul défaillant sur mes propres droits ou cagnottes en cas de non-remboursement avéré.
                        </li>
                        <li>
                          Mon acceptation est définitive pour toute la durée du cycle et autorise l&apos;administrateur à valider l&apos;entrée de ce membre.
                        </li>
                      </ul>
                    </div>

                    <label className="flex items-start gap-2.5 cursor-pointer select-none p-2.5 rounded-xl bg-emerald-50/70 border border-emerald-200/80">
                      <input
                        type="checkbox"
                        checked={Boolean(checkedMap[r.id])}
                        onChange={(e) =>
                          setCheckedMap((prev) => ({ ...prev, [r.id]: e.target.checked }))
                        }
                        className="mt-0.5 w-4 h-4 accent-emerald-700 flex-shrink-0 cursor-pointer"
                      />
                      <span className="text-xs font-bold text-emerald-950">
                        J&apos;ai lu attentivement et j&apos;accepte pleinement les engagements de garant pour {r.applicant.name}.
                      </span>
                    </label>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={busyId === r.id}
                        onClick={() => respond(r.id, "DECLINED")}
                        className="flex-1 py-2.5 px-3 rounded-xl bg-red-50 border border-red-200 text-red-700 font-bold text-xs hover:bg-red-100 cursor-pointer disabled:opacity-50"
                      >
                        Refuser
                      </button>
                      <button
                        type="button"
                        disabled={busyId === r.id || !checkedMap[r.id]}
                        onClick={() => respond(r.id, "ACCEPTED")}
                        className="flex-1 py-2.5 px-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                      >
                        {busyId === r.id ? <LoadingSpinner /> : <span className="material-symbols-outlined text-[16px]">verified</span>}
                        <span>Accepter d&apos;être garant</span>
                      </button>
                    </div>
                  </>
                )}

                {!isPending && (
                  <p className="text-xs text-slate-500">
                    {isAccepted
                      ? `✅ Vous avez accepté les engagements de garant le ${r.guarantorAcceptedAt ? new Date(r.guarantorAcceptedAt).toLocaleString("fr-FR") : ""}.`
                      : `❌ Refusé${r.guarantorDeclineReason ? ` : ${r.guarantorDeclineReason}` : ""}.`}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

