"use client";

import { useState } from "react";
import Link from "next/link";
import { formatXAF } from "@/lib/format-currency";
import { LoadingSpinner } from "@/components/loading-spinner";
import type { Lang } from "@/lib/i18n/translations";

interface PrivateSlot {
  id: string;
  beneficiaryName: string;
  officialPosition: number | null;
  ballDrawn: number | null;
}

interface PrivateMembership {
  id: string;
  userId: string;
  userName: string;
  userPhone: string | null;
  status: string;
  slotCount: number | null;
  joinedAt: string;
  slots: PrivateSlot[];
}

export interface PrivateTontineItem {
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
  inviteToken: string | null;
  inviteUrl: string | null;
  isCreator: boolean;
  creatorName: string;
  pendingCount: number;
  approvedCount: number;
  memberships: PrivateMembership[];
}

const CADENCE_OPTIONS = [
  { value: "HEBDO_SUNDAY", label: "Hebdomadaire — Chaque Dimanche" },
  { value: "EVERY_SATURDAY", label: "Hebdomadaire — Chaque Samedi" },
  { value: "EVERY_MONDAY", label: "Hebdomadaire — Chaque Lundi" },
  { value: "EVERY_WEDNESDAY", label: "Hebdomadaire — Chaque Mercredi" },
  { value: "EVERY_FRIDAY", label: "Hebdomadaire — Chaque Vendredi" },
  { value: "BIWEEKLY_SUNDAY", label: "Bimensuelle — Tous les 2 Dimanches" },
  { value: "MONTHLY_1", label: "Mensuelle — Le 1er du mois" },
  { value: "MONTHLY_5", label: "Mensuelle — Le 5 du mois" },
  { value: "MONTHLY_15", label: "Mensuelle — Le 15 du mois" },
  { value: "MONTHLY_25", label: "Mensuelle — Le 25 du mois" },
  { value: "MONTHLY_28", label: "Mensuelle — Le 28 du mois" },
  { value: "QUARTERLY_25", label: "Trimestrielle — Le 25 tous les 3 mois" },
];

export function PrivateTontinesClient({
  lang,
  initialTontines,
}: {
  lang: Lang;
  initialTontines: PrivateTontineItem[];
}) {
  const [tontines, setTontines] = useState<PrivateTontineItem[]>(initialTontines);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [managingId, setManagingId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Create form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState("HEBDO_SUNDAY");
  const [amount, setAmount] = useState(10000);
  const [fee, setFee] = useState(0);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  });
  const [limitTime, setLimitTime] = useState("18:30");
  const [maxSlots, setMaxSlots] = useState<string>("12");

  async function refreshList() {
    const res = await fetch("/api/private-tontines");
    if (res.ok) {
      const data = await res.json();
      setTontines(data.tontines || []);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      const res = await fetch("/api/private-tontines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: description.trim() || undefined,
          type,
          amount: Number(amount),
          fee: Number(fee),
          startDate,
          limitTime,
          maxSlots: maxSlots.trim() ? Number(maxSlots) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateError(data.error || "Erreur lors de la création");
        return;
      }
      setShowCreate(false);
      setTitle("");
      setDescription("");
      setFeedback(
        lang === "fr"
          ? "Tontine privée créée ! Partagez votre lien unique d'invitation sur WhatsApp."
          : "Private tontine created! Share your unique invite link on WhatsApp.",
      );
      await refreshList();
    } catch {
      setCreateError("Erreur réseau lors de la création.");
    } finally {
      setCreating(false);
    }
  }

  function copyLink(id: string, url: string) {
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  }

  function shareOnWhatsApp(t: PrivateTontineItem) {
    if (!t.inviteUrl) return;
    const text = `🌿 Je t'invite à rejoindre notre tontine privée "${t.title}" (${formatXAF(t.amount)}) sur DIVA Asso !\n\nClique sur ce lien sécurisé pour demander ton accès :\n${t.inviteUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }

  function shareBySms(t: PrivateTontineItem) {
    if (!t.inviteUrl) return;
    const text = `Invitation tontine privée "${t.title}" (${formatXAF(t.amount)}) sur DIVA Asso : ${t.inviteUrl}`;
    window.location.href = `sms:?body=${encodeURIComponent(text)}`;
  }

  async function runManageAction(tontineId: string, body: Record<string, unknown>, key: string) {
    setBusyAction(key);
    setFeedback(null);
    try {
      const res = await fetch(`/api/private-tontines/${tontineId}/manage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback(data.error || "Erreur lors de l'action");
      } else {
        await refreshList();
      }
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <main className="px-container-padding py-stack-gap-lg max-w-4xl mx-auto w-full flex flex-col gap-6 pb-24">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[11px] font-bold mb-1">
            <span className="material-symbols-outlined text-[14px]">lock</span>
            <span>{lang === "fr" ? "Cercles fermés sur invitation" : "Invite-only Private Circles"}</span>
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
            {lang === "fr" ? "Cotisations Privées" : "Private Tontines"}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {lang === "fr"
              ? "Créez votre propre tontine familiale, entre collègues ou amis. Invisible publiquement, accessible uniquement par votre lien sécurisé."
              : "Create your own private tontine for family, colleagues, or friends. Hidden from public listings, accessible via invite link only."}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowCreate((prev) => !prev)}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-on-primary font-bold text-sm hover:opacity-90 active:scale-95 transition-all shadow-sm cursor-pointer flex-shrink-0"
        >
          <span className="material-symbols-outlined text-[20px]">add_circle</span>
          <span>{lang === "fr" ? "Créer une tontine privée" : "Create Private Tontine"}</span>
        </button>
      </div>

      {/* Isolation notice (Pilier 3.4.1) */}
      <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 text-xs text-slate-600 flex items-start gap-2.5">
        <span className="material-symbols-outlined text-amber-700 text-[20px] flex-shrink-0">shield</span>
        <span>
          <strong>{lang === "fr" ? "Confidentialité & Isolation :" : "Privacy & Isolation:"}</strong>{" "}
          {lang === "fr"
            ? "Les cotisations privées n'apparaissent jamais sur le tableau public et sont séparées de la caisse publique de prêts d'urgence DIVA Asso."
            : "Private tontines never appear on public boards and are isolated from the public DIVA Asso emergency loan pool."}
        </span>
      </div>

      {feedback && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 font-semibold flex items-center gap-2">
          <span className="material-symbols-outlined text-emerald-700 text-[18px]">check_circle</span>
          <span>{feedback}</span>
        </div>
      )}

      {/* Creation form */}
      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="bg-white rounded-3xl p-5 sm:p-6 shadow-md border border-emerald-900/15 flex flex-col gap-4"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="font-bold text-base text-slate-900">
              {lang === "fr" ? "Nouvelle Tontine Privée" : "New Private Tontine"}
            </h2>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="text-slate-400 hover:text-slate-700 cursor-pointer"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          {createError && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-medium">
              {createError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1 sm:col-span-2">
              <label className="text-xs font-bold text-slate-700">Nom de la tontine *</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex: Tontine Famille Kamga / Collègues Bureau"
                className="border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>

            <div className="flex flex-col gap-1 sm:col-span-2">
              <label className="text-xs font-bold text-slate-700">Description / Règlement interne</label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Objectif, règles de bouffe, heure limite..."
                className="border border-slate-200 rounded-xl px-3.5 py-2 text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-700">Fréquence *</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm bg-slate-50 focus:bg-white"
              >
                {CADENCE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-700">Mise unitaire (FCFA) *</label>
              <input
                type="number"
                min={1000}
                step={500}
                required
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                className="border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-bold bg-slate-50 focus:bg-white"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-700">Date de démarrage *</label>
              <input
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm bg-slate-50 focus:bg-white"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-700">Heure limite (HH:MM)</label>
              <input
                type="time"
                value={limitTime}
                onChange={(e) => setLimitTime(e.target.value)}
                className="border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm bg-slate-50 focus:bg-white"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-700">Nombre max de places (optionnel)</label>
              <input
                type="number"
                min={2}
                max={100}
                value={maxSlots}
                onChange={(e) => setMaxSlots(e.target.value)}
                placeholder="Illimité si vide"
                className="border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm bg-slate-50 focus:bg-white"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-700">Frais internes par cotisation (FCFA)</label>
              <input
                type="number"
                min={0}
                step={100}
                value={fee}
                onChange={(e) => setFee(Number(e.target.value))}
                className="border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm bg-slate-50 focus:bg-white"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-bold text-xs cursor-pointer"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={creating}
              className="px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {creating ? <LoadingSpinner /> : <span className="material-symbols-outlined text-[18px]">check</span>}
              <span>Créer & Générer le lien d&apos;invitation</span>
            </button>
          </div>
        </form>
      )}

      {/* List of user's private tontines */}
      {tontines.length === 0 ? (
        <div className="bg-white rounded-3xl p-10 text-center border border-slate-200/80 flex flex-col items-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center">
            <span className="material-symbols-outlined text-3xl">lock</span>
          </div>
          <h3 className="font-bold text-base text-slate-900">Aucune cotisation privée pour le moment</h3>
          <p className="text-xs text-slate-500 max-w-sm">
            Créez votre première tontine privée en 30 secondes et invitez vos proches sur WhatsApp avec votre lien unique sécurisé.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {tontines.map((t) => {
            const isOpen = managingId === t.id;
            const pendingMembers = t.memberships.filter((m) => m.status === "PENDING");
            const approvedMembers = t.memberships.filter((m) => m.status === "APPROVED");

            return (
              <div
                key={t.id}
                className="bg-white rounded-3xl p-5 shadow-sm border border-slate-200/80 flex flex-col gap-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-bold uppercase">
                        Privée
                      </span>
                      {t.isCreator && (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 text-[10px] font-bold uppercase">
                          Gestionnaire
                        </span>
                      )}
                      <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[10px] font-bold">
                        {t.status}
                      </span>
                    </div>
                    <h3 className="text-lg font-extrabold text-slate-900 mt-1">{t.title}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Mise : <strong className="text-slate-900">{formatXAF(t.amount)}</strong> ·{" "}
                      {t.approvedCount} membre(s) validé(s)
                      {t.pendingCount > 0 && (
                        <span className="ml-1.5 text-amber-700 font-bold">
                          · {t.pendingCount} demande(s) en attente
                        </span>
                      )}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <Link
                      href={`/sessions/${t.id}`}
                      className="px-3.5 py-2 rounded-xl bg-emerald-50 text-emerald-900 border border-emerald-200 font-bold text-xs hover:bg-emerald-100 transition-colors"
                    >
                      Ouvrir la tontine
                    </Link>
                    {t.isCreator && (
                      <button
                        type="button"
                        onClick={() => setManagingId(isOpen ? null : t.id)}
                        className="px-3.5 py-2 rounded-xl bg-slate-900 text-white font-bold text-xs hover:bg-slate-800 transition-colors cursor-pointer flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-[16px]">tune</span>
                        <span>{isOpen ? "Fermer gestion" : "Gérer"}</span>
                        {t.pendingCount > 0 && (
                          <span className="ml-1 px-1.5 py-0.2 rounded-full bg-amber-400 text-slate-900 text-[10px] font-extrabold">
                            {t.pendingCount}
                          </span>
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {/* Invite Link Box */}
                {t.inviteUrl && (
                  <div className="p-3.5 rounded-2xl bg-emerald-50/70 border border-emerald-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-[10px] font-bold uppercase text-emerald-800 tracking-wide">
                        Lien unique d&apos;invitation sécurisé
                      </span>
                      <p className="text-xs font-mono text-emerald-950 truncate mt-0.5">{t.inviteUrl}</p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => shareOnWhatsApp(t)}
                        className="px-3 py-1.5 rounded-lg bg-[#25D366] text-white font-bold text-xs hover:opacity-90 cursor-pointer flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-[16px]">share</span>
                        WhatsApp
                      </button>
                      <button
                        type="button"
                        onClick={() => shareBySms(t)}
                        className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 font-bold text-xs hover:bg-slate-50 cursor-pointer"
                      >
                        SMS
                      </button>
                      <button
                        type="button"
                        onClick={() => copyLink(t.id, t.inviteUrl!)}
                        className="px-2.5 py-1.5 rounded-lg bg-white border border-emerald-300 text-emerald-900 font-bold text-xs hover:bg-emerald-50 cursor-pointer"
                      >
                        {copiedId === t.id ? "✓ Copié" : "Copier"}
                      </button>
                    </div>
                  </div>
                )}

                {/* Creator Management Panel */}
                {t.isCreator && isOpen && (
                  <div className="pt-3 border-t border-slate-100 flex flex-col gap-4">
                    {/* Status controls */}
                    <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 p-3 rounded-2xl">
                      <span className="text-xs font-bold text-slate-700">Statut du cycle :</span>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {(["DRAFT", "DRAWING", "ACTIVE", "CLOSED"] as const).map((st) => (
                          <button
                            key={st}
                            type="button"
                            disabled={busyAction !== null || t.status === st}
                            onClick={() =>
                              runManageAction(t.id, { action: "set_status", status: st }, `${t.id}-${st}`)
                            }
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition-colors ${
                              t.status === st
                                ? "bg-emerald-700 text-white"
                                : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-100"
                            }`}
                          >
                            {st === "DRAFT"
                              ? "Préparation"
                              : st === "DRAWING"
                                ? "Tirage"
                                : st === "ACTIVE"
                                  ? "Actif"
                                  : "Clôturé"}
                          </button>
                        ))}
                        <button
                          type="button"
                          disabled={busyAction !== null}
                          onClick={() =>
                            runManageAction(t.id, { action: "regenerate_token" }, `${t.id}-regen`)
                          }
                          className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-amber-50 border border-amber-300 text-amber-900 hover:bg-amber-100 cursor-pointer"
                          title="Révoquer l'ancien lien et générer un nouveau lien d'invitation"
                        >
                          🔄 Régénérer lien
                        </button>
                      </div>
                    </div>

                    {/* Pending Join Requests */}
                    {pendingMembers.length > 0 && (
                      <div className="flex flex-col gap-2">
                        <h4 className="text-xs font-bold text-amber-800 uppercase">
                          Demandes d&apos;entrée en attente ({pendingMembers.length})
                        </h4>
                        {pendingMembers.map((m) => (
                          <div
                            key={m.id}
                            className="p-3 rounded-xl border border-amber-200 bg-amber-50/50 flex items-center justify-between gap-2"
                          >
                            <div>
                              <p className="text-xs font-bold text-slate-900">{m.userName}</p>
                              {m.userPhone && (
                                <p className="text-[11px] text-slate-500">{m.userPhone}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                disabled={busyAction !== null}
                                onClick={() =>
                                  runManageAction(
                                    t.id,
                                    { action: "decide_membership", membershipId: m.id, decision: "APPROVED" },
                                    `app-${m.id}`,
                                  )
                                }
                                className="px-3 py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-bold hover:bg-emerald-800 cursor-pointer"
                              >
                                Accepter
                              </button>
                              <button
                                type="button"
                                disabled={busyAction !== null}
                                onClick={() =>
                                  runManageAction(
                                    t.id,
                                    { action: "decide_membership", membershipId: m.id, decision: "REJECTED" },
                                    `rej-${m.id}`,
                                  )
                                }
                                className="px-3 py-1.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs font-bold hover:bg-red-100 cursor-pointer"
                              >
                                Refuser
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Approved members & payout positions */}
                    <div className="flex flex-col gap-2">
                      <h4 className="text-xs font-bold text-slate-700 uppercase">
                        Membres & Ordre de passage ({approvedMembers.length})
                      </h4>
                      <div className="flex flex-col divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden">
                        {approvedMembers.flatMap((m) =>
                          m.slots.map((s) => (
                            <div
                              key={s.id}
                              className="px-3.5 py-2.5 flex items-center justify-between bg-white text-xs"
                            >
                              <div className="flex items-center gap-2.5">
                                <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-900 font-bold flex items-center justify-center text-[11px]">
                                  {s.officialPosition ?? "—"}
                                </span>
                                <span className="font-semibold text-slate-900">{s.beneficiaryName}</span>
                              </div>
                              <span className="text-[11px] text-slate-400">
                                {m.userPhone || m.userName}
                              </span>
                            </div>
                          )),
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

