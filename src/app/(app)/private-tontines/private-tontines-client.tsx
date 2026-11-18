"use client";

import { useState } from "react";
import Link from "next/link";
import { formatXAF } from "@/lib/format-currency";
import { LoadingSpinner } from "@/components/loading-spinner";
import type { Lang } from "@/lib/i18n/translations";
import type { PrivateTontineCreationConfig } from "@/lib/private-tontine-config";

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
  isPaused: boolean;
  isLocked: boolean;
  privateApprovalStatus: string;
  privateRejectionReason: string | null;
  privateConfig?: { selectedActions?: string[] } | null;
  startDate: string;
  limitTime: string;
  maxSlots: number | null;
  fineAmountPerPeriod: number;
  fineIntervalHours: number;
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

function sanitizeNumericInput(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  return digits.replace(/^0+(?=\d)/, "");
}

export function PrivateTontinesClient({
  lang,
  initialTontines,
  privateRulesContent,
  creationConfig,
  currentUserId,
}: {
  lang: Lang;
  initialTontines: PrivateTontineItem[];
  privateRulesContent: string;
  creationConfig: PrivateTontineCreationConfig;
  currentUserId: string;
}) {
  const availableAdminActions = creationConfig.actions.filter((a) => a.enabledByAdmin);
  const [selectedActions, setSelectedActions] = useState<string[]>(() =>
    availableAdminActions.filter((a) => a.defaultSelected).map((a) => a.key),
  );

  function toggleSelectedAction(key: string) {
    setSelectedActions((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }
  const [tontines, setTontines] = useState<PrivateTontineItem[]>(initialTontines);
  const [showCreate, setShowCreate] = useState(initialTontines.length === 0);
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
  const [amountInput, setAmountInput] = useState("10000");
  const [feeInput, setFeeInput] = useState("");
  const [fineInput, setFineInput] = useState("500");
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  });
  const [limitTime, setLimitTime] = useState("18:30");
  const [maxSlots, setMaxSlots] = useState<string>("12");
  const [rulesAccepted, setRulesAccepted] = useState(false);

  // Inline edit state per managed tontine
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editLimitTime, setEditLimitTime] = useState("18:30");
  const [editFineInput, setEditFineInput] = useState("500");
  const [editMaxSlots, setEditMaxSlots] = useState("");

  // Broadcast announcement state per managed tontine
  const [broadcastMessage, setBroadcastMessage] = useState("");

  async function refreshList() {
    const res = await fetch("/api/private-tontines");
    if (res.ok) {
      const data = await res.json();
      setTontines(data.tontines || []);
    }
  }

  function startEdit(t: PrivateTontineItem) {
    setEditingId(t.id);
    setEditTitle(t.title);
    setEditDescription(t.description || "");
    setEditLimitTime(t.limitTime);
    setEditFineInput(String(t.fineAmountPerPeriod ?? 500));
    setEditMaxSlots(t.maxSlots ? String(t.maxSlots) : "");
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    if (!rulesAccepted) {
      setCreateError("Vous devez lire et accepter les règles des cotisations privées DIVA Asso.");
      return;
    }
    const parsedAmount = Number(amountInput || "0");
    if (
      !Number.isFinite(parsedAmount) ||
      parsedAmount < creationConfig.minAmount ||
      parsedAmount > creationConfig.maxAmount
    ) {
      setCreateError(
        `La mise unitaire doit être comprise entre ${formatXAF(creationConfig.minAmount)} et ${formatXAF(creationConfig.maxAmount)}.`,
      );
      return;
    }
    if (maxSlots.trim()) {
      const parsedSlots = Number(maxSlots);
      if (parsedSlots < creationConfig.minSlots || parsedSlots > creationConfig.maxSlotsLimit) {
        setCreateError(
          `Le nombre de places doit être compris entre ${creationConfig.minSlots} et ${creationConfig.maxSlotsLimit}.`,
        );
        return;
      }
    }

    setCreating(true);
    try {
      const res = await fetch("/api/private-tontines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: description.trim() || undefined,
          type,
          amount: parsedAmount,
          fee: Number(feeInput || "0"),
          fineAmountPerPeriod: selectedActions.includes("allow_fines") ? Number(fineInput || "0") : 0,
          startDate,
          limitTime,
          maxSlots: maxSlots.trim() ? Number(maxSlots) : null,
          selectedActions,
          rulesAccepted: true,
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
      setRulesAccepted(false);
      setFeedback(
        data.message ||
          (lang === "fr"
            ? "Demande envoyée ! Votre cotisation privée est en attente de validation par DIVA Asso. Dès validation, votre lien d'invitation sécurisé apparaîtra ici."
            : "Submitted! Your private cotisation is awaiting DIVA Asso admin approval."),
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
    const text = `🌿 Je t'invite à rejoindre notre cotisation privée "${t.title}" (${formatXAF(t.amount)}) sur DIVA Asso !\n\nCrée ton compte DIVA Asso puis clique sur ce lien sécurisé pour demander ton accès :\n${t.inviteUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }

  function shareBySms(t: PrivateTontineItem) {
    if (!t.inviteUrl) return;
    const text = `Invitation cotisation privée "${t.title}" (${formatXAF(t.amount)}) sur DIVA Asso : ${t.inviteUrl}`;
    window.location.href = `sms:?body=${encodeURIComponent(text)}`;
  }

  async function runManageAction(
    tontineId: string,
    body: Record<string, unknown>,
    key: string,
    successMessage?: string,
  ) {
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
        if (successMessage) setFeedback(successMessage);
        if (body.action === "update_details") setEditingId(null);
        if (body.action === "broadcast_members") setBroadcastMessage("");
        await refreshList();
      }
    } finally {
      setBusyAction(null);
    }
  }

  function moveSlotOrder(t: PrivateTontineItem, slotId: string, direction: -1 | 1) {
    const allSlots = t.memberships
      .filter((m) => m.status === "APPROVED")
      .flatMap((m) => m.slots)
      .sort((a, b) => (a.officialPosition ?? 9999) - (b.officialPosition ?? 9999));

    const idx = allSlots.findIndex((s) => s.id === slotId);
    const targetIdx = idx + direction;
    if (idx < 0 || targetIdx < 0 || targetIdx >= allSlots.length) return;

    const reordered = [...allSlots];
    const [moved] = reordered.splice(idx, 1);
    reordered.splice(targetIdx, 0, moved);

    const slotOrders = reordered.map((s, i) => ({
      slotId: s.id,
      officialPosition: i + 1,
    }));

    runManageAction(
      t.id,
      { action: "set_order", slotOrders },
      `reorder-${slotId}`,
      "Ordre de passage mis à jour !",
    );
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
            {lang === "fr" ? "Créer cotisation privée" : "Private Cotisations"}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {lang === "fr"
              ? "Créez votre propre cotisation privée (famille, collègues, amis). Après validation par DIVA Asso, partagez votre lien sécurisé uniquement aux personnes invitées."
              : "Create your own private cotisation for family, colleagues, or friends. Once approved by DIVA Asso, share your private invite link."}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowCreate((prev) => !prev)}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-on-primary font-bold text-sm hover:opacity-90 active:scale-95 transition-all shadow-sm cursor-pointer flex-shrink-0"
        >
          <span className="material-symbols-outlined text-[20px]">add_circle</span>
          <span>{lang === "fr" ? "Créer cotisation privée" : "Create Private Cotisation"}</span>
        </button>
      </div>

      {/* Isolation notice */}
      <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 text-xs text-slate-600 flex items-start gap-2.5">
        <span className="material-symbols-outlined text-amber-700 text-[20px] flex-shrink-0">shield</span>
        <span>
          <strong>{lang === "fr" ? "Validation & Confidentialité :" : "Approval & Privacy:"}</strong>{" "}
          {lang === "fr"
            ? "Chaque cotisation privée est vérifiée par l'administration DIVA Asso avant activation du lien d'invitation. Elle reste totalement invisible du public, et chaque invité doit créer un compte DIVA Asso pour l'intégrer."
            : "Every private cotisation is reviewed by DIVA Asso before its invite link is activated. Invited members must have a DIVA Asso account to join."}
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
              {lang === "fr" ? "Nouvelle Cotisation Privée" : "New Private Cotisation"}
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
              <label className="text-xs font-bold text-slate-700">Nom de la cotisation privée *</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex: Cotisation Famille / Collègues du bureau"
                className="border-2 border-emerald-600 rounded-xl px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600/30"
              />
            </div>

            <div className="flex flex-col gap-1 sm:col-span-2">
              <label className="text-xs font-bold text-slate-700">Description / Règlement interne</label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Objectif, règles internes, heure limite..."
                className="border-2 border-emerald-600 rounded-xl px-3.5 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600/30"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-700">Fréquence *</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="border-2 border-emerald-600 rounded-xl px-3.5 py-2.5 text-sm bg-white"
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
                type="text"
                inputMode="numeric"
                required
                value={amountInput}
                onChange={(e) => setAmountInput(sanitizeNumericInput(e.target.value))}
                placeholder="Ex: 10000"
                className="border-2 border-emerald-600 rounded-xl px-3.5 py-2.5 text-sm font-bold bg-white"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-700">Date de démarrage *</label>
              <input
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="border-2 border-emerald-600 rounded-xl px-3.5 py-2.5 text-sm bg-white"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-700">Heure limite (HH:MM)</label>
              <input
                type="time"
                value={limitTime}
                onChange={(e) => setLimitTime(e.target.value)}
                className="border-2 border-emerald-600 rounded-xl px-3.5 py-2.5 text-sm bg-white"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-700">
                Nombre de places (min {creationConfig.minSlots} · max {creationConfig.maxSlotsLimit})
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={maxSlots}
                onChange={(e) => setMaxSlots(sanitizeNumericInput(e.target.value))}
                placeholder={`Ex: ${Math.max(creationConfig.minSlots, 10)}`}
                className="border-2 border-emerald-600 rounded-xl px-3.5 py-2.5 text-sm bg-white"
              />
            </div>

            {selectedActions.includes("allow_fines") && (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-slate-700">Amende de retard (FCFA)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={fineInput}
                  onChange={(e) => setFineInput(sanitizeNumericInput(e.target.value))}
                  placeholder="Ex: 500"
                  className="border-2 border-emerald-600 rounded-xl px-3.5 py-2.5 text-sm bg-white"
                />
              </div>
            )}

            <div className="flex flex-col gap-1 sm:col-span-2">
              <label className="text-xs font-bold text-slate-700">Frais internes par cotisation (FCFA, optionnel)</label>
              <input
                type="text"
                inputMode="numeric"
                value={feeInput}
                onChange={(e) => setFeeInput(sanitizeNumericInput(e.target.value))}
                placeholder="0"
                className="border-2 border-emerald-600 rounded-xl px-3.5 py-2.5 text-sm bg-white"
              />
            </div>
          </div>

          {/* Creator selectable actions/options configured by DIVA Asso Admin */}
          {availableAdminActions.length > 0 && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 flex flex-col gap-2.5">
              <div className="flex items-center gap-2 text-emerald-950 font-bold text-xs uppercase">
                <span className="material-symbols-outlined text-[18px] text-emerald-700">tune</span>
                <span>Choisissez les fonctionnalités de votre cotisation privée</span>
              </div>
              <p className="text-[11px] text-slate-600">
                Cochez uniquement les actions que vous souhaitez activer dans votre cotisation et décochez celles que vous ne voulez pas.
              </p>
              <div className="flex flex-col gap-2">
                {availableAdminActions.map((act) => {
                  const checked = selectedActions.includes(act.key);
                  return (
                    <label
                      key={act.key}
                      className={`flex items-start gap-2.5 p-2.5 rounded-xl border cursor-pointer transition-colors ${
                        checked
                          ? "bg-white border-emerald-500"
                          : "bg-white/60 border-slate-200"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelectedAction(act.key)}
                        className="mt-0.5 w-4 h-4 accent-emerald-700 rounded cursor-pointer flex-shrink-0"
                      />
                      <div className="min-w-0">
                        <span className="text-xs font-bold text-slate-900 block">{act.label}</span>
                        {act.description && (
                          <span className="text-[11px] text-slate-500">{act.description}</span>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Mandatory DIVA Asso Private Cotisation Rules */}
          <div className="rounded-2xl border-2 border-amber-300 bg-amber-50/50 p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-amber-950 font-bold text-xs uppercase">
              <span className="material-symbols-outlined text-[18px] text-amber-700">gavel</span>
              <span>Règlement officiel des cotisations privées — DIVA Asso</span>
            </div>
            <div className="max-h-48 overflow-y-auto rounded-xl bg-white border border-amber-200 p-3 text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">
              {privateRulesContent}
            </div>
            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rulesAccepted}
                onChange={(e) => setRulesAccepted(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-emerald-700 rounded cursor-pointer flex-shrink-0"
              />
              <span className="text-xs font-semibold text-slate-800">
                J&apos;ai lu et j&apos;accepte intégralement les règles des cotisations privées DIVA Asso. Je comprends que ma cotisation doit être validée par DIVA Asso avant activation du lien d&apos;invitation.
              </span>
            </label>
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
              disabled={creating || !rulesAccepted}
              className="px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {creating ? <LoadingSpinner /> : <span className="material-symbols-outlined text-[18px]">send</span>}
              <span>Soumettre pour validation DIVA Asso</span>
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
            Créez votre première cotisation privée, faites-la valider par DIVA Asso et invitez vos proches avec votre lien unique sécurisé.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {tontines.map((t) => {
            const isOpen = managingId === t.id;
            const pendingMembers = t.memberships.filter((m) => m.status === "PENDING");
            const approvedMembers = t.memberships.filter((m) => m.status === "APPROVED");
            const orderedSlots = approvedMembers
              .flatMap((m) => m.slots.map((s) => ({ ...s, membership: m })))
              .sort((a, b) => (a.officialPosition ?? 9999) - (b.officialPosition ?? 9999));

            const isPendingAdmin = t.privateApprovalStatus === "PENDING_ADMIN";
            const isRejectedAdmin = t.privateApprovalStatus === "REJECTED";
            const isApprovedAdmin = t.privateApprovalStatus === "APPROVED";

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
                          Propriétaire
                        </span>
                      )}
                      {isPendingAdmin && (
                        <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-900 text-[10px] font-bold">
                          ⏳ En attente validation DIVA Asso
                        </span>
                      )}
                      {isRejectedAdmin && (
                        <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-800 text-[10px] font-bold">
                          Refusée par DIVA Asso
                        </span>
                      )}
                      {t.isPaused && (
                        <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 text-[10px] font-bold">
                          En pause
                        </span>
                      )}
                      {t.isLocked && (
                        <span className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 text-[10px] font-bold">
                          Inscriptions verrouillées
                        </span>
                      )}
                      <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[10px] font-bold">
                        {t.status}
                      </span>
                    </div>
                    <h3 className="text-lg font-extrabold text-slate-900 mt-1">{t.title}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Mise : <strong className="text-slate-900">{formatXAF(t.amount)}</strong> ·{" "}
                      Amende : <strong className="text-slate-900">{formatXAF(t.fineAmountPerPeriod)}</strong> ·{" "}
                      {t.approvedCount} membre(s) validé(s)
                      {t.maxSlots ? ` / ${t.maxSlots}` : ""}
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
                      Ouvrir la cotisation
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

                {/* Admin approval status banners */}
                {isPendingAdmin && (
                  <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-950 flex items-start gap-2.5">
                    <span className="material-symbols-outlined text-amber-700 text-[18px] flex-shrink-0">hourglass_top</span>
                    <span>
                      <strong>En attente de validation par l&apos;admin DIVA Asso :</strong> votre lien d&apos;invitation sécurisé sera automatiquement généré et visible ici dès que l&apos;administration aura approuvé votre cotisation privée.
                    </span>
                  </div>
                )}

                {isRejectedAdmin && (
                  <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2.5">
                    <span className="material-symbols-outlined text-red-600 text-[18px] flex-shrink-0">error</span>
                    <span>
                      <strong>Demande refusée par DIVA Asso :</strong>{" "}
                      {t.privateRejectionReason || "Veuillez contacter le support DIVA Asso pour plus d'informations."}
                    </span>
                  </div>
                )}

                {/* Invite Link Box (ONLY when approved by DIVA Asso admin) */}
                {isApprovedAdmin && t.inviteUrl && (
                  <div className="p-3.5 rounded-2xl bg-emerald-50/70 border border-emerald-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-[10px] font-bold uppercase text-emerald-800 tracking-wide">
                        Lien unique d&apos;invitation sécurisé (compte DIVA Asso requis)
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

                {/* Rich Creator Management Panel */}
                {t.isCreator && isOpen && (
                  <div className="pt-3 border-t border-slate-100 flex flex-col gap-4">
                    {/* Quick owner toolbar */}
                    <div className="flex flex-wrap items-center gap-2 bg-slate-50 p-3 rounded-2xl">
                      <button
                        type="button"
                        onClick={() => (editingId === t.id ? setEditingId(null) : startEdit(t))}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-slate-200 text-slate-800 hover:bg-slate-100 cursor-pointer flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-[15px]">edit</span>
                        <span>Modifier paramètres</span>
                      </button>

                      <button
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() =>
                          runManageAction(
                            t.id,
                            { action: "toggle_pause" },
                            `${t.id}-pause`,
                            t.isPaused ? "Cotisation relancée." : "Cotisation mise en pause.",
                          )
                        }
                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-slate-200 text-slate-800 hover:bg-slate-100 cursor-pointer flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-[15px]">
                          {t.isPaused ? "play_arrow" : "pause"}
                        </span>
                        <span>{t.isPaused ? "Reprendre" : "Mettre en pause"}</span>
                      </button>

                      <button
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() =>
                          runManageAction(
                            t.id,
                            { action: "toggle_lock" },
                            `${t.id}-lock`,
                            t.isLocked ? "Inscriptions déverrouillées." : "Inscriptions verrouillées.",
                          )
                        }
                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-slate-200 text-slate-800 hover:bg-slate-100 cursor-pointer flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-[15px]">
                          {t.isLocked ? "lock_open" : "lock"}
                        </span>
                        <span>{t.isLocked ? "Ouvrir inscriptions" : "Fermer inscriptions"}</span>
                      </button>

                      <button
                        type="button"
                        disabled={busyAction !== null || orderedSlots.length < 2}
                        onClick={() => {
                          if (!window.confirm("Effectuer un tirage au sort aléatoire de l'ordre de bouffe ?")) return;
                          runManageAction(
                            t.id,
                            { action: "shuffle_order" },
                            `${t.id}-shuffle`,
                            "Tirage au sort effectué et membres notifiés !",
                          );
                        }}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-700 text-white hover:bg-emerald-800 cursor-pointer disabled:opacity-40 flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-[15px]">casino</span>
                        <span>Tirage au sort</span>
                      </button>

                      {isApprovedAdmin && (
                        <button
                          type="button"
                          disabled={busyAction !== null}
                          onClick={() =>
                            runManageAction(
                              t.id,
                              { action: "regenerate_token" },
                              `${t.id}-regen`,
                              "Nouveau lien d'invitation généré !",
                            )
                          }
                          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-50 border border-amber-300 text-amber-900 hover:bg-amber-100 cursor-pointer flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined text-[15px]">refresh</span>
                          <span>Régénérer lien</span>
                        </button>
                      )}
                    </div>

                    {/* Cycle Status controls */}
                    <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 p-3 rounded-2xl">
                      <span className="text-xs font-bold text-slate-700">Statut du cycle :</span>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {(["DRAFT", "DRAWING", "ACTIVE", "CLOSED"] as const).map((st) => (
                          <button
                            key={st}
                            type="button"
                            disabled={busyAction !== null || t.status === st}
                            onClick={() =>
                              runManageAction(
                                t.id,
                                { action: "set_status", status: st },
                                `${t.id}-${st}`,
                                "Statut du cycle mis à jour.",
                              )
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
                      </div>
                    </div>

                    {/* Inline Settings Editor */}
                    {editingId === t.id && (
                      <div className="p-4 rounded-2xl border-2 border-emerald-200 bg-emerald-50/30 flex flex-col gap-3">
                        <h4 className="text-xs font-bold text-emerald-950 uppercase">Modifier les paramètres</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1 sm:col-span-2">
                            <label className="text-[11px] font-bold text-slate-700">Titre</label>
                            <input
                              type="text"
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                              className="border-2 border-emerald-600 rounded-xl px-3 py-2 text-xs bg-white"
                            />
                          </div>
                          <div className="flex flex-col gap-1 sm:col-span-2">
                            <label className="text-[11px] font-bold text-slate-700">Description / Règlement interne</label>
                            <textarea
                              rows={2}
                              value={editDescription}
                              onChange={(e) => setEditDescription(e.target.value)}
                              className="border-2 border-emerald-600 rounded-xl px-3 py-2 text-xs bg-white"
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[11px] font-bold text-slate-700">Heure limite</label>
                            <input
                              type="time"
                              value={editLimitTime}
                              onChange={(e) => setEditLimitTime(e.target.value)}
                              className="border-2 border-emerald-600 rounded-xl px-3 py-2 text-xs bg-white"
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[11px] font-bold text-slate-700">Amende retard (FCFA)</label>
                            <input
                              type="text"
                              inputMode="numeric"
                              value={editFineInput}
                              onChange={(e) => setEditFineInput(sanitizeNumericInput(e.target.value))}
                              className="border-2 border-emerald-600 rounded-xl px-3 py-2 text-xs bg-white"
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[11px] font-bold text-slate-700">Places max</label>
                            <input
                              type="text"
                              inputMode="numeric"
                              value={editMaxSlots}
                              onChange={(e) => setEditMaxSlots(sanitizeNumericInput(e.target.value))}
                              placeholder="Illimité"
                              className="border-2 border-emerald-600 rounded-xl px-3 py-2 text-xs bg-white"
                            />
                          </div>
                        </div>
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-700 cursor-pointer"
                          >
                            Annuler
                          </button>
                          <button
                            type="button"
                            disabled={busyAction !== null}
                            onClick={() =>
                              runManageAction(
                                t.id,
                                {
                                  action: "update_details",
                                  title: editTitle,
                                  description: editDescription || null,
                                  limitTime: editLimitTime,
                                  fineAmountPerPeriod: Number(editFineInput || "0"),
                                  maxSlots: editMaxSlots.trim() ? Number(editMaxSlots) : null,
                                },
                                `${t.id}-save-edit`,
                                "Paramètres mis à jour !",
                              )
                            }
                            className="px-4 py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-bold hover:bg-emerald-800 cursor-pointer"
                          >
                            Enregistrer
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Broadcast message to all members */}
                    <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/70 flex flex-col gap-2">
                      <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[16px] text-emerald-700">campaign</span>
                        <span>Envoyer une annonce à tous les membres</span>
                      </h4>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="text"
                          value={broadcastMessage}
                          onChange={(e) => setBroadcastMessage(e.target.value)}
                          placeholder="Ex: Rappel de cotisation avant dimanche 18h30..."
                          className="flex-1 border-2 border-emerald-600 rounded-xl px-3 py-2 text-xs bg-white"
                        />
                        <button
                          type="button"
                          disabled={busyAction !== null || broadcastMessage.trim().length < 3}
                          onClick={() =>
                            runManageAction(
                              t.id,
                              { action: "broadcast_members", message: broadcastMessage.trim() },
                              `${t.id}-broadcast`,
                              "Annonce envoyée à tous les membres !",
                            )
                          }
                          className="px-4 py-2 rounded-xl bg-emerald-700 text-white text-xs font-bold hover:bg-emerald-800 cursor-pointer disabled:opacity-40"
                        >
                          Envoyer
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
                                    `${m.userName} a été accepté(e) !`,
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
                                    "Demande refusée.",
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

                    {/* Approved members & payout positions with manual reorder + remove */}
                    <div className="flex flex-col gap-2">
                      <h4 className="text-xs font-bold text-slate-700 uppercase">
                        Membres &amp; Ordre de bouffe ({orderedSlots.length} place(s))
                      </h4>
                      <div className="flex flex-col divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden">
                        {orderedSlots.map((s, idx) => (
                          <div
                            key={s.id}
                            className="px-3.5 py-2.5 flex items-center justify-between gap-2 bg-white text-xs"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-900 font-bold flex items-center justify-center text-[11px] flex-shrink-0">
                                {s.officialPosition ?? idx + 1}
                              </span>
                              <div className="min-w-0">
                                <span className="font-semibold text-slate-900 block truncate">
                                  {s.beneficiaryName}
                                </span>
                                <span className="text-[11px] text-slate-400">
                                  {s.membership.userPhone || s.membership.userName}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-1 flex-shrink-0">
                              <button
                                type="button"
                                disabled={busyAction !== null || idx === 0}
                                onClick={() => moveSlotOrder(t, s.id, -1)}
                                className="w-7 h-7 rounded-lg border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 disabled:opacity-30 cursor-pointer"
                                title="Monter dans l'ordre"
                              >
                                <span className="material-symbols-outlined text-[16px]">arrow_upward</span>
                              </button>
                              <button
                                type="button"
                                disabled={busyAction !== null || idx === orderedSlots.length - 1}
                                onClick={() => moveSlotOrder(t, s.id, 1)}
                                className="w-7 h-7 rounded-lg border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 disabled:opacity-30 cursor-pointer"
                                title="Descendre dans l'ordre"
                              >
                                <span className="material-symbols-outlined text-[16px]">arrow_downward</span>
                              </button>
                              {s.membership.userId !== currentUserId && (
                                <button
                                  type="button"
                                  disabled={busyAction !== null}
                                  onClick={() => {
                                    if (!window.confirm(`Retirer ${s.membership.userName} de cette cotisation privée ?`)) return;
                                    runManageAction(
                                      t.id,
                                      { action: "remove_member", membershipId: s.membership.id },
                                      `rem-${s.membership.id}`,
                                      `${s.membership.userName} a été retiré(e).`,
                                    );
                                  }}
                                  className="w-7 h-7 rounded-lg border border-red-200 bg-red-50 flex items-center justify-center text-red-700 hover:bg-red-100 cursor-pointer"
                                  title="Retirer ce membre"
                                >
                                  <span className="material-symbols-outlined text-[15px]">person_remove</span>
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
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
