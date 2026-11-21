"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatXAF } from "@/lib/format-currency";
import { LoadingSpinner } from "@/components/loading-spinner";
import type { Lang } from "@/lib/i18n/translations";
import type { PrivateTontineCreationConfig } from "@/lib/private-tontine-config";
import { getNextValidStartDates } from "@/lib/cycle-date-validation";
import { calculatePrivatePlatformFee } from "@/lib/private-tontine-finance";
import type { TontineType } from "@/generated/prisma/enums";

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

export interface EmergencyFundData {
  id: string;
  name: string;
  minimumAmount: number;
  description: string | null;
  rules: string | null;
  isActive: boolean;
  contributions: {
    id: string;
    amount: number;
    userId: string;
    user: { name: string };
    createdAt: string;
  }[];
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
  creatorParticipates: boolean;
  privateMinParticipants: number | null;
  privateAdditionalFeePayoutPct: number;
  privatePenaltyBeneficiaryPct: number;
  parentSessionId: string | null;
  privateConfig?: {
    selectedActions?: string[];
    creatorFullName?: string;
    creatorPhotoUrl?: string;
    creatorIdDocUrl?: string;
    guarantorId?: string;
    guarantorName?: string;
    guarantorPhone?: string;
    guarantorStatus?: string;
    [key: string]: unknown;
  } | null;
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
  emergencyFund: EmergencyFundData | null;
  memberships: PrivateMembership[];
}

const CADENCE_OPTIONS = [
  { value: "HEBDO_SUNDAY", label: "Hebdomadaire — Chaque Dimanche" },
  { value: "EVERY_MONDAY", label: "Hebdomadaire — Chaque Lundi" },
  { value: "EVERY_TUESDAY", label: "Hebdomadaire — Chaque Mardi" },
  { value: "EVERY_WEDNESDAY", label: "Hebdomadaire — Chaque Mercredi" },
  { value: "EVERY_THURSDAY", label: "Hebdomadaire — Chaque Jeudi" },
  { value: "EVERY_FRIDAY", label: "Hebdomadaire — Chaque Vendredi" },
  { value: "EVERY_SATURDAY", label: "Hebdomadaire — Chaque Samedi" },
  { value: "BIWEEKLY_SUNDAY", label: "Bimensuelle — Tous les 2 Dimanches" },
  { value: "MONTHLY_1", label: "Mensuelle — Le 1er du mois" },
  { value: "MONTHLY_5", label: "Mensuelle — Le 5 du mois" },
  { value: "MONTHLY_10", label: "Mensuelle — Le 10 du mois" },
  { value: "MONTHLY_15", label: "Mensuelle — Le 15 du mois" },
  { value: "MONTHLY_20", label: "Mensuelle — Le 20 du mois" },
  { value: "MONTHLY_25", label: "Mensuelle — Le 25 du mois" },
  { value: "MONTHLY_28", label: "Mensuelle — Le 28 du mois" },
  { value: "QUARTERLY_25", label: "Trimestrielle — Le 25 tous les 3 mois" },
];

function sanitizeNumericInput(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  return digits.replace(/^0+(?=\d)/, "");
}

function formatDateFr(isoOrYmd: string): string {
  const d = new Date(isoOrYmd.includes("T") ? isoOrYmd : `${isoOrYmd}T12:00:00Z`);
  return d.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Africa/Douala",
  });
}

export interface PendingGuarantorRequest {
  sessionId: string;
  sessionTitle: string;
  amount: number;
  creatorName: string;
  creatorPhone: string;
  creatorPhotoUrl?: string | null;
}

export interface GuaranteedEngagement {
  sessionId: string;
  sessionTitle: string;
  amount: number;
  frequency: string;
  creatorId: string | null;
  creatorName: string;
  creatorPhone: string;
  creatorPhotoUrl?: string | null;
  creatorIdDocUrl?: string | null;
  privateApprovalStatus: string;
  sessionStatus: string;
  guarantorRespondedAt?: string | null;
  approvedMembersCount: number;
}

export interface EligibleGuarantor {
  id: string;
  name: string;
  phone: string | null;
  publicSessionTitle: string;
}

export function PrivateTontinesClient({
  lang,
  initialTontines,
  privateRulesContent,
  creationConfig,
  currentUserId,
  currentUserName = "",
  initialGuarantorRequests = [],
  initialGuaranteedEngagements = [],
}: {
  lang: Lang;
  initialTontines: PrivateTontineItem[];
  privateRulesContent: string;
  creationConfig: PrivateTontineCreationConfig;
  currentUserId: string;
  currentUserName?: string;
  initialGuarantorRequests?: PendingGuarantorRequest[];
  initialGuaranteedEngagements?: GuaranteedEngagement[];
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
  const [guarantorRequests, setGuarantorRequests] = useState<PendingGuarantorRequest[]>(initialGuarantorRequests);
  const [guaranteedEngagements, setGuaranteedEngagements] = useState<GuaranteedEngagement[]>(initialGuaranteedEngagements);
  const [activeTab, setActiveTab] = useState<"MY_TONTINES" | "GUARANTEED_MEMBERS">("MY_TONTINES");
  const [respondingGuarantorId, setRespondingGuarantorId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(initialTontines.length === 0);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [managingId, setManagingId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // KYC & Guarantor state for private tontine creation
  const [creatorFullName, setCreatorFullName] = useState(currentUserName);
  const [creatorPhotoUrl, setCreatorPhotoUrl] = useState("");
  const [creatorPhotoUploading, setCreatorPhotoUploading] = useState(false);
  const [creatorIdDocUrl, setCreatorIdDocUrl] = useState("");
  const [creatorIdDocUploading, setCreatorIdDocUploading] = useState(false);
  const [guarantorId, setGuarantorId] = useState("");
  const [eligibleGuarantors, setEligibleGuarantors] = useState<EligibleGuarantor[]>([]);
  const [loadingGuarantors, setLoadingGuarantors] = useState(false);

  // Transfer ownership modal state
  const [transferTontineId, setTransferTontineId] = useState<string | null>(null);
  const [transferTargetUserId, setTransferTargetUserId] = useState<string>("");

  // Emergency fund contribution modal state
  const [contributeFundId, setContributeFundId] = useState<string | null>(null);
  const [contributeAmountInput, setContributeAmountInput] = useState<string>("1000");

  // Create form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<TontineType>("HEBDO_SUNDAY");
  const [creatorParticipates, setCreatorParticipates] = useState<boolean>(true);
  const [amountInput, setAmountInput] = useState("2500");
  const [feeInput, setFeeInput] = useState("");
  const [fineInput, setFineInput] = useState("500");
  const [limitTime, setLimitTime] = useState("18:30");
  const [maxSlots, setMaxSlots] = useState<string>("10");
  const [minParticipantsInput, setMinParticipantsInput] = useState<string>("10");
  const [additionalFeePayoutPct, setAdditionalFeePayoutPct] = useState<number>(100);
  const [penaltyBeneficiaryPct, setPenaltyBeneficiaryPct] = useState<number>(100);
  const [rulesAccepted, setRulesAccepted] = useState(false);

  // Optional Emergency fund form state
  const [emergencyFundEnabled, setEmergencyFundEnabled] = useState<boolean>(false);
  const [emergencyFundName, setEmergencyFundName] = useState<string>("Caisse de secours");
  const [emergencyFundMinAmount, setEmergencyFundMinAmount] = useState<string>("1000");
  const [emergencyFundRules, setEmergencyFundRules] = useState<string>("");

  // Generate valid start dates strictly adhering to chosen cycle
  const validDatesForType = useMemo(() => {
    return getNextValidStartDates(type, 12);
  }, [type]);

  const [startDate, setStartDate] = useState<string>(() => {
    const list = getNextValidStartDates("HEBDO_SUNDAY", 12);
    return list[0] || "";
  });

  // Keep startDate strictly in sync with validDatesForType
  function handleTypeChange(newType: string) {
    const typed = newType as TontineType;
    setType(typed);
    const newValidDates = getNextValidStartDates(typed, 12);
    setStartDate(newValidDates[0] || "");
  }

  // Live platform fee calculation (5.1% of entire cycle contribution)
  const parsedUnitAmount = parseInt(amountInput, 10) || 0;
  const parsedSlotsCount = parseInt(maxSlots, 10) || 10;
  const simulatedPlatformFee = useMemo(() => {
    return calculatePrivatePlatformFee(parsedUnitAmount, parsedSlotsCount);
  }, [parsedUnitAmount, parsedSlotsCount]);

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

  // Load eligible guarantors from public sessions
  useEffect(() => {
    if (!showCreate) return;
    setLoadingGuarantors(true);
    fetch("/api/private-tontines/eligible-guarantors")
      .then((r) => r.json())
      .then((d) => setEligibleGuarantors(d.guarantors || []))
      .catch(() => {})
      .finally(() => setLoadingGuarantors(false));
  }, [showCreate]);

  async function handleFileUpload(file: File, type: "photo" | "id_doc") {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("type", type);
    if (type === "photo") setCreatorPhotoUploading(true);
    else setCreatorIdDocUploading(true);

    try {
      const res = await fetch("/api/private-tontines/upload-doc", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateError(data.error || "Erreur lors du téléversement du fichier.");
        return;
      }
      if (type === "photo") setCreatorPhotoUrl(data.url);
      else setCreatorIdDocUrl(data.url);
    } catch {
      setCreateError("Erreur réseau lors du téléversement.");
    } finally {
      if (type === "photo") setCreatorPhotoUploading(false);
      else setCreatorIdDocUploading(false);
    }
  }

  async function handleGuarantorDecision(sessionId: string, decision: "ACCEPT" | "REJECT") {
    setRespondingGuarantorId(sessionId);
    try {
      const res = await fetch(`/api/private-tontines/${sessionId}/guarantor-response`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Erreur lors de la réponse.");
        return;
      }
      const matchedReq = guarantorRequests.find((r) => r.sessionId === sessionId);
      if (decision === "ACCEPT" && matchedReq) {
        setGuaranteedEngagements((prev) => [
          {
            sessionId: matchedReq.sessionId,
            sessionTitle: matchedReq.sessionTitle,
            amount: matchedReq.amount,
            frequency: "TONTINE",
            creatorId: "",
            creatorName: matchedReq.creatorName,
            creatorPhone: matchedReq.creatorPhone,
            creatorPhotoUrl: matchedReq.creatorPhotoUrl || null,
            privateApprovalStatus: "PENDING_ADMIN",
            sessionStatus: "DRAFT",
            guarantorRespondedAt: new Date().toISOString(),
            approvedMembersCount: 1,
          },
          ...prev,
        ]);
      }
      setGuarantorRequests((prev) => prev.filter((r) => r.sessionId !== sessionId));
      setFeedback(data.message || (decision === "ACCEPT" ? "Cautionnement accepté avec succès !" : "Cautionnement refusé."));
      await refreshList();
    } catch {
      alert("Erreur réseau.");
    } finally {
      setRespondingGuarantorId(null);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    if (!rulesAccepted) {
      setCreateError("Vous devez lire et accepter les règles des cotisations privées DIVA Asso.");
      return;
    }
    if (!creatorFullName.trim()) {
      setCreateError("Veuillez renseigner votre nom complet.");
      return;
    }
    if (!creatorPhotoUrl) {
      setCreateError("Veuillez téléverser votre photo portrait (au format image).");
      return;
    }
    if (!creatorIdDocUrl) {
      setCreateError("Veuillez téléverser votre pièce d'identité (CNI, récépissé ou passeport).");
      return;
    }
    if (!guarantorId) {
      setCreateError("Veuillez sélectionner un garant inscrit dans une cotisation publique DIVA Asso.");
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
    const parsedSlots = Number(maxSlots || "0");
    if (!Number.isFinite(parsedSlots) || parsedSlots < creationConfig.minSlots) {
      setCreateError(
        `Le nombre de places doit être supérieur ou égal au nombre minimal fixé par l'administrateur (${creationConfig.minSlots} places).`,
      );
      return;
    }
    if (parsedSlots > creationConfig.maxSlotsLimit) {
      setCreateError(
        `Le nombre de places ne peut pas dépasser ${creationConfig.maxSlotsLimit} places.`,
      );
      return;
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
          maxSlots: parsedSlots,
          creatorParticipates,
          privateAdditionalFeePayoutPct: additionalFeePayoutPct,
          privatePenaltyBeneficiaryPct: penaltyBeneficiaryPct,
          selectedActions,
          rulesAccepted: true,
          creatorFullName: creatorFullName.trim(),
          creatorPhotoUrl,
          creatorIdDocUrl,
          guarantorId,
          emergencyFund: emergencyFundEnabled
            ? {
                enabled: true,
                name: emergencyFundName.trim() || "Caisse de secours",
                minimumAmount: parseInt(emergencyFundMinAmount, 10) || 1000,
                description: emergencyFundRules.trim() || undefined,
              }
            : undefined,
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
      setCreatorPhotoUrl("");
      setCreatorIdDocUrl("");
      setGuarantorId("");
      setRulesAccepted(false);
      setFeedback(
        data.message ||
          (lang === "fr"
            ? "Demande envoyée ! Le garant désigné a été notifié. Dès acceptation du garant et validation par l'administration DIVA Asso, votre lien d'invitation sécurisé apparaîtra ici."
            : "Submitted! Awaiting guarantor acceptance and DIVA Asso admin approval."),
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
        if (body.action === "transfer_ownership") setTransferTontineId(null);
        await refreshList();
      }
    } finally {
      setBusyAction(null);
    }
  }

  async function handleLeaveTontine(tontineId: string) {
    if (!window.confirm("Êtes-vous sûr de vouloir quitter cette cotisation privée ?")) return;
    setBusyAction(`leave-${tontineId}`);
    try {
      const res = await fetch(`/api/private-tontines/${tontineId}/leave`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback(data.error || "Impossible de quitter la cotisation.");
      } else {
        setFeedback(data.message || "Vous avez quitté la cotisation.");
        await refreshList();
      }
    } finally {
      setBusyAction(null);
    }
  }

  async function handleContributeEmergencyFund(fundId: string) {
    const amount = parseInt(contributeAmountInput, 10);
    if (!amount || amount < 100) {
      alert("Montant invalide.");
      return;
    }
    setBusyAction(`fund-contrib-${fundId}`);
    try {
      const res = await fetch(`/api/private-tontines/${fundId}/emergency-fund/contribute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, paymentMethod: "WALLET" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback(data.error || "Impossible de contribuer.");
      } else {
        setFeedback(data.message || "Contribution enregistrée !");
        setContributeFundId(null);
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
            {lang === "fr" ? "Créer ma cotisation" : "Create My Cotisation"}
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
          <span>{lang === "fr" ? "Créer ma cotisation" : "Create My Cotisation"}</span>
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

      {/* Pending Guarantor Requests Banner */}
      {guarantorRequests.length > 0 && (
        <div className="flex flex-col gap-3">
          {guarantorRequests.map((req) => (
            <div
              key={req.sessionId}
              className="p-4 rounded-2xl bg-amber-50 border-2 border-amber-300 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="flex items-start gap-2.5">
                <span className="material-symbols-outlined text-amber-700 text-[24px] flex-shrink-0">
                  verified_user
                </span>
                <div>
                  <span className="px-2 py-0.5 rounded-full bg-amber-200 text-amber-950 text-[10px] font-extrabold uppercase">
                    Demande de cautionnement
                  </span>
                  <p className="text-xs text-amber-950 font-bold mt-1">
                    {req.creatorName} {req.creatorPhone ? `(${req.creatorPhone})` : ""} vous a désigné comme garant pour créer la cotisation privée « {req.sessionTitle} » ({formatXAF(req.amount)}).
                  </p>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    Acceptez-vous de vous porter garant de cette cotisation privée ?
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 self-end sm:self-center">
                <button
                  type="button"
                  disabled={respondingGuarantorId === req.sessionId}
                  onClick={() => handleGuarantorDecision(req.sessionId, "REJECT")}
                  className="px-3 py-1.5 rounded-xl border border-red-300 text-red-700 text-xs font-bold hover:bg-red-50 cursor-pointer disabled:opacity-50"
                >
                  Refuser
                </button>
                <button
                  type="button"
                  disabled={respondingGuarantorId === req.sessionId}
                  onClick={() => handleGuarantorDecision(req.sessionId, "ACCEPT")}
                  className="px-3.5 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                >
                  {respondingGuarantorId === req.sessionId ? <LoadingSpinner /> : <span className="material-symbols-outlined text-[16px]">check</span>}
                  <span>Accepter d&apos;être garant</span>
                </button>
              </div>
            </div>
          ))}
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
              {lang === "fr" ? "Créer ma cotisation" : "Create My Cotisation"}
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
              <label className="text-xs font-bold text-slate-700">Nom de la cotisation *</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex: Tontine Solidarité Famille"
                className="border-2 border-emerald-600 rounded-xl px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600/30"
              />
            </div>

            <div className="flex flex-col gap-1 sm:col-span-2">
              <label className="text-xs font-bold text-slate-700">Description / Objectif</label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex: Épargne hebdomadaire et entraide mutuelle"
                className="border-2 border-emerald-600 rounded-xl px-3.5 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600/30"
              />
            </div>

            {/* Identité du créateur (KYC) & Cautionnement Garant */}
            <div className="sm:col-span-2 rounded-2xl border-2 border-emerald-300 bg-emerald-50/50 p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2 text-emerald-950 font-bold text-xs uppercase">
                <span className="material-symbols-outlined text-[18px] text-emerald-700">verified_user</span>
                <span>Vérification d&apos;identité &amp; Cautionnement garant (Obligatoire)</span>
              </div>
              <p className="text-[11px] text-slate-600">
                Pour garantir la sécurité de la communauté, le créateur d&apos;une cotisation privée doit fournir son nom complet, une photo portrait, une pièce d&apos;identité (CNI, récépissé ou passeport) et désigner un garant membre d&apos;une cotisation publique.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-emerald-200">
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Nom et prénom(s) complets du créateur *
                  </label>
                  <input
                    type="text"
                    value={creatorFullName}
                    onChange={(e) => setCreatorFullName(e.target.value)}
                    placeholder="Ex: Valentine Dupont"
                    className="w-full border-2 border-emerald-600 rounded-xl px-3.5 py-2 text-sm bg-white"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    1. Photo portrait du créateur *
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFileUpload(f, "photo");
                    }}
                    className="w-full text-xs text-slate-600 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-emerald-700 file:text-white hover:file:bg-emerald-800 cursor-pointer"
                  />
                  {creatorPhotoUploading && (
                    <span className="text-[10px] text-emerald-700 font-bold flex items-center gap-1 mt-1">
                      <LoadingSpinner /> Téléversement de la photo...
                    </span>
                  )}
                  {creatorPhotoUrl && !creatorPhotoUploading && (
                    <span className="text-[10px] text-emerald-800 font-bold flex items-center gap-1 mt-1">
                      ✓ Photo enregistrée avec succès
                    </span>
                  )}
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    2. CNI / Récépissé / Passeport *
                  </label>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFileUpload(f, "id_doc");
                    }}
                    className="w-full text-xs text-slate-600 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-emerald-700 file:text-white hover:file:bg-emerald-800 cursor-pointer"
                  />
                  {creatorIdDocUploading && (
                    <span className="text-[10px] text-emerald-700 font-bold flex items-center gap-1 mt-1">
                      <LoadingSpinner /> Téléversement du document...
                    </span>
                  )}
                  {creatorIdDocUrl && !creatorIdDocUploading && (
                    <span className="text-[10px] text-emerald-800 font-bold flex items-center gap-1 mt-1">
                      ✓ Document CNI enregistré avec succès
                    </span>
                  )}
                </div>

                <div className="sm:col-span-2 pt-2 border-t border-emerald-200">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Désignation du garant (Membre en cotisation publique DIVA Asso) *
                  </label>
                  {loadingGuarantors ? (
                    <p className="text-xs text-slate-500 flex items-center gap-1.5">
                      <LoadingSpinner /> Recherche des membres éligibles...
                    </p>
                  ) : (
                    <select
                      value={guarantorId}
                      onChange={(e) => setGuarantorId(e.target.value)}
                      className="w-full border-2 border-emerald-600 rounded-xl px-3 py-2 text-xs font-semibold bg-white"
                      required
                    >
                      <option value="">-- Choisir un membre garant --</option>
                      {eligibleGuarantors.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name} {g.phone ? `(${g.phone})` : ""} — Cotisation publique : {g.publicSessionTitle}
                        </option>
                      ))}
                    </select>
                  )}
                  <span className="text-[10px] text-slate-500 mt-1 block leading-relaxed">
                    Le garant doit figurer dans une cotisation publique active. Dès soumission, il recevra une notification pour accepter ou refuser de cautionner votre cotisation.
                  </span>
                </div>
              </div>
            </div>

            {/* Creator participation role */}
            <div className="flex flex-col gap-1.5 sm:col-span-2 bg-slate-50 p-3 rounded-xl border border-slate-200">
              <span className="text-xs font-bold text-slate-800">Votre rôle dans la cotisation :</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label
                  className={`flex items-center gap-2 p-2.5 rounded-lg border-2 cursor-pointer transition-colors ${
                    creatorParticipates ? "border-emerald-600 bg-white" : "border-slate-200 bg-white/60"
                  }`}
                >
                  <input
                    type="radio"
                    name="creatorRole"
                    checked={creatorParticipates}
                    onChange={() => setCreatorParticipates(true)}
                    className="accent-emerald-700"
                  />
                  <div className="text-xs">
                    <strong className="block text-slate-900">Gestionnaire & Membre participant</strong>
                    <span className="text-[11px] text-slate-500">Vous cotisez et bouffez comme chaque membre</span>
                  </div>
                </label>
                <label
                  className={`flex items-center gap-2 p-2.5 rounded-lg border-2 cursor-pointer transition-colors ${
                    !creatorParticipates ? "border-emerald-600 bg-white" : "border-slate-200 bg-white/60"
                  }`}
                >
                  <input
                    type="radio"
                    name="creatorRole"
                    checked={!creatorParticipates}
                    onChange={() => setCreatorParticipates(false)}
                    className="accent-emerald-700"
                  />
                  <div className="text-xs">
                    <strong className="block text-slate-900">Gestionnaire uniquement</strong>
                    <span className="text-[11px] text-slate-500">Vous pilotez sans cotiser ni bouffer</span>
                  </div>
                </label>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-700">Fréquence du cycle *</label>
              <select
                value={type}
                onChange={(e) => handleTypeChange(e.target.value)}
                className="border-2 border-emerald-600 rounded-xl px-3.5 py-2.5 text-sm bg-white"
              >
                {CADENCE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Cycle-strict Start Date Dropdown */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-700">Date de démarrage (selon cycle) *</label>
              <select
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="border-2 border-emerald-600 rounded-xl px-3.5 py-2.5 text-sm bg-white font-medium capitalize"
              >
                {validDatesForType.map((d) => (
                  <option key={d} value={d}>
                    {formatDateFr(d)}
                  </option>
                ))}
              </select>
              <span className="text-[10px] text-emerald-800 font-semibold mt-0.5">
                ✓ Respecte strictement la fréquence choisie
              </span>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-700">Mise unitaire par place (FCFA) *</label>
              <input
                type="text"
                inputMode="numeric"
                required
                value={amountInput}
                onChange={(e) => setAmountInput(sanitizeNumericInput(e.target.value))}
                placeholder="Ex: 2 500 FCFA"
                className="border-2 border-emerald-600 rounded-xl px-3.5 py-2.5 text-sm font-bold bg-white"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-700">Heure limite de versement</label>
              <input
                type="time"
                value={limitTime}
                onChange={(e) => setLimitTime(e.target.value)}
                className="border-2 border-emerald-600 rounded-xl px-3.5 py-2.5 text-sm bg-white"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-700">
                Nombre de places / tours (min {creationConfig.minSlots}) *
              </label>
              <input
                type="text"
                inputMode="numeric"
                required
                value={maxSlots}
                onChange={(e) => setMaxSlots(sanitizeNumericInput(e.target.value))}
                placeholder={`Ex: ${creationConfig.minSlots}`}
                className={`border-2 rounded-xl px-3.5 py-2.5 text-sm bg-white ${
                  maxSlots && Number(maxSlots) < creationConfig.minSlots
                    ? "border-red-500 bg-red-50/40 text-red-900"
                    : "border-emerald-600"
                }`}
              />
              {maxSlots && Number(maxSlots) < creationConfig.minSlots ? (
                <span className="text-[10px] text-red-600 font-bold mt-0.5">
                  Le nombre de places doit être supérieur ou égal au nombre minimal fixé par l&apos;administrateur ({creationConfig.minSlots} places).
                </span>
              ) : (
                <span className="text-[10px] text-slate-500 mt-0.5">
                  Minimum requis par DIVA Asso : {creationConfig.minSlots} places
                </span>
              )}
            </div>

            {/* Platform Fee Notice */}
            <div className="sm:col-span-2 rounded-xl bg-emerald-50/70 border border-emerald-200 p-3.5 text-xs text-emerald-950 flex flex-col gap-1.5">
              <div className="flex items-center gap-2 font-extrabold text-emerald-900 text-sm">
                <span className="material-symbols-outlined text-emerald-700 text-[18px]">verified</span>
                <span>Frais clairs et transparents DIVA Asso</span>
              </div>
              <p className="text-xs font-bold text-emerald-800">
                Frais sur tout argent qui entre : 5,1% · Frais sur tout ce qui sort : 0%
              </p>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                Les frais sont appliqués uniquement lors des dépôts et des cotisations. Tous les retraits et décaissements de gains vers Mobile Money sont strictement sans frais (0%).
              </p>
            </div>

            {/* Additional internal fee & split */}
            <div className="flex flex-col gap-2 sm:col-span-2 bg-slate-50 p-3 rounded-xl border border-slate-200">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <label className="text-xs font-bold text-slate-700">
                  Frais internes additionnels par versement (FCFA, optionnel)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={feeInput}
                  onChange={(e) => setFeeInput(sanitizeNumericInput(e.target.value))}
                  placeholder="Ex: 100 FCFA"
                  className="border-2 border-emerald-600 rounded-lg px-3 py-1.5 text-xs bg-white w-36"
                />
              </div>

              {Number(feeInput) > 0 && (
                <div className="pt-2 border-t border-slate-200 flex flex-col gap-1 text-xs">
                  <div className="flex justify-between">
                    <span className="font-semibold text-slate-700">
                      Répartition des frais additionnels :
                    </span>
                    <span className="font-bold text-emerald-800">
                      {additionalFeePayoutPct}% cagnotte · {100 - additionalFeePayoutPct}% créateur
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={10}
                    value={additionalFeePayoutPct}
                    onChange={(e) => setAdditionalFeePayoutPct(Number(e.target.value))}
                    className="accent-emerald-700 cursor-pointer"
                  />
                </div>
              )}
            </div>

            {/* Fine & Penalty Split */}
            {selectedActions.includes("allow_fines") && (
              <div className="flex flex-col gap-2 sm:col-span-2 bg-slate-50 p-3 rounded-xl border border-slate-200">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <label className="text-xs font-bold text-slate-700">Amende de retard (FCFA)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={fineInput}
                    onChange={(e) => setFineInput(sanitizeNumericInput(e.target.value))}
                    placeholder="Ex: 500 FCFA"
                    className="border-2 border-emerald-600 rounded-lg px-3 py-1.5 text-xs bg-white w-36"
                  />
                </div>
                <div className="pt-2 border-t border-slate-200 flex flex-col gap-1 text-xs">
                  <div className="flex justify-between">
                    <span className="font-semibold text-slate-700">
                      Répartition de la pénalité payée :
                    </span>
                    <span className="font-bold text-emerald-800">
                      {penaltyBeneficiaryPct}% bénéficiaire retardé · {100 - penaltyBeneficiaryPct}% créateur
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={10}
                    value={penaltyBeneficiaryPct}
                    onChange={(e) => setPenaltyBeneficiaryPct(Number(e.target.value))}
                    className="accent-emerald-700 cursor-pointer"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Optional Emergency Fund Section */}
          <div className="rounded-2xl border-2 border-amber-200 bg-amber-50/40 p-4 flex flex-col gap-3">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={emergencyFundEnabled}
                onChange={(e) => setEmergencyFundEnabled(e.target.checked)}
                className="w-4 h-4 accent-emerald-700 rounded cursor-pointer"
              />
              <span className="text-xs font-bold text-amber-950 uppercase tracking-wide">
                Activer une caisse de secours (optionnelle & isolée)
              </span>
            </label>

            {emergencyFundEnabled && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-amber-200/80">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Nom de la caisse de secours
                  </label>
                  <input
                    type="text"
                    value={emergencyFundName}
                    onChange={(e) => setEmergencyFundName(e.target.value)}
                    placeholder="Ex: Caisse de secours"
                    className="w-full border-2 border-emerald-600 rounded-lg px-3 py-1.5 text-xs bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Montant minimum par contribution (FCFA)
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={emergencyFundMinAmount}
                    onChange={(e) => setEmergencyFundMinAmount(sanitizeNumericInput(e.target.value))}
                    placeholder="Ex: 1 000 FCFA"
                    className="w-full border-2 border-emerald-600 rounded-lg px-3 py-1.5 text-xs bg-white"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Règles d&apos;attribution de secours (optionnel)
                  </label>
                  <textarea
                    rows={2}
                    value={emergencyFundRules}
                    onChange={(e) => setEmergencyFundRules(e.target.value)}
                    placeholder="Ex: Décaissement en cas d'hospitalisation ou d'événement familial..."
                    className="w-full border-2 border-emerald-600 rounded-lg px-3 py-1.5 text-xs bg-white"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Creator selectable actions/options configured by DIVA Asso Admin */}
          {availableAdminActions.length > 0 && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 flex flex-col gap-2.5">
              <div className="flex items-center gap-2 text-emerald-950 font-bold text-xs uppercase">
                <span className="material-symbols-outlined text-[18px] text-emerald-700">tune</span>
                <span>Choisissez les fonctionnalités de votre cotisation</span>
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

      {/* ── Onglets de Navigation : Mes cotisations / Personnes cautionnées (Vice-Versa) ── */}
      <div className="flex items-center gap-2 border-b border-slate-200/80 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab("MY_TONTINES")}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
            activeTab === "MY_TONTINES"
              ? "bg-slate-900 text-white shadow-xs"
              : "bg-slate-100 text-slate-700 hover:bg-slate-200"
          }`}
        >
          <span className="material-symbols-outlined text-[16px]">groups</span>
          <span>{lang === "fr" ? "Mes cotisations" : "My Cotisations"}</span>
          <span
            className={`px-1.5 py-0.2 rounded-full text-[10px] font-extrabold ${
              activeTab === "MY_TONTINES"
                ? "bg-white/20 text-white"
                : "bg-slate-300 text-slate-800"
            }`}
          >
            {tontines.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("GUARANTEED_MEMBERS")}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
            activeTab === "GUARANTEED_MEMBERS"
              ? "bg-slate-900 text-white shadow-xs"
              : "bg-slate-100 text-slate-700 hover:bg-slate-200"
          }`}
        >
          <span className="material-symbols-outlined text-[16px]">shield_person</span>
          <span>{lang === "fr" ? "Personnes cautionnées" : "Guaranteed Members"}</span>
          {guaranteedEngagements.length > 0 && (
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] font-extrabold ${
                activeTab === "GUARANTEED_MEMBERS"
                  ? "bg-emerald-400 text-slate-950"
                  : "bg-emerald-100 text-emerald-900"
              }`}
            >
              {guaranteedEngagements.length}
            </span>
          )}
        </button>
      </div>

      {activeTab === "MY_TONTINES" && (
        <>
          {/* List of user's private tontines */}
          {tontines.length === 0 ? (
            <div className="bg-white rounded-3xl p-10 text-center border border-slate-200/80 flex flex-col items-center gap-3">
              <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center">
                <span className="material-symbols-outlined text-3xl">lock</span>
              </div>
              <h3 className="font-bold text-base text-slate-900">Aucune cotisation pour le moment</h3>
              <p className="text-xs text-slate-500 max-w-sm">
                Créez votre première cotisation avec le bouton &quot;Créer ma cotisation&quot;, faites-la valider par DIVA Asso et invitez vos proches avec votre lien unique sécurisé.
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

            const minParticipants = t.privateMinParticipants || 10;
            const hasReachedMinParticipants = approvedMembers.length >= minParticipants;

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
                      {t.isCreator && t.privateConfig?.guarantorStatus === "PENDING" && (
                        <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-950 text-[10px] font-bold">
                          ⏳ Accord garant en attente ({t.privateConfig?.guarantorName || "Garant"})
                        </span>
                      )}
                      {t.isCreator && t.privateConfig?.guarantorStatus === "ACCEPTED" && (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 text-[10px] font-bold">
                          ✓ Garant validé ({t.privateConfig?.guarantorName || "Garant"})
                        </span>
                      )}
                      {t.isCreator && t.privateConfig?.guarantorStatus === "REJECTED" && (
                        <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-900 text-[10px] font-bold">
                          ✕ Garant a refusé ({t.privateConfig?.guarantorName || "Garant"})
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

                    {/* Non-creator member leave button */}
                    {!t.isCreator && (
                      <button
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() => handleLeaveTontine(t.id)}
                        className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-red-50 text-slate-700 hover:text-red-700 text-xs font-bold cursor-pointer"
                      >
                        Quitter
                      </button>
                    )}

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

                {/* Minimum participants tracking badge */}
                <div className="flex items-center gap-2 text-xs">
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-bold ${
                      hasReachedMinParticipants
                        ? "bg-emerald-100 text-emerald-900"
                        : "bg-amber-100 text-amber-950"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[15px]">
                      {hasReachedMinParticipants ? "check_circle" : "group"}
                    </span>
                    <span>
                      {approvedMembers.length} / {minParticipants} participants requis pour démarrer
                    </span>
                  </span>
                  {!hasReachedMinParticipants && (
                    <span className="text-[11px] text-slate-500">
                      (Il manque {minParticipants - approvedMembers.length} participant(s))
                    </span>
                  )}
                </div>

                {/* Admin approval status banners */}
                {isPendingAdmin && (
                  <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-950 flex items-start gap-2.5">
                    <span className="material-symbols-outlined text-amber-700 text-[18px] flex-shrink-0">hourglass_top</span>
                    <span>
                      <strong>En attente de validation par l&apos;admin DIVA Asso :</strong> votre lien d&apos;invitation sécurisé sera automatiquement généré et visible ici dès que l&apos;administration aura approuvé votre cotisation.
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

                {/* Vice-versa: Creator sees designated guarantor coordinates & status */}
                {t.isCreator && (t.privateConfig?.guarantorName || t.privateConfig?.guarantorPhone) && (
                  <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-xs flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="font-bold text-slate-900 flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[18px] text-emerald-700">shield_person</span>
                        Garant désigné de ma cotisation :
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                          t.privateConfig.guarantorStatus === "ACCEPTED"
                            ? "bg-emerald-100 text-emerald-950 border border-emerald-300"
                            : t.privateConfig.guarantorStatus === "REJECTED"
                            ? "bg-red-100 text-red-950 border border-red-300"
                            : "bg-amber-100 text-amber-950 border border-amber-300"
                        }`}
                      >
                        {t.privateConfig.guarantorStatus === "ACCEPTED"
                          ? "✓ Prise en charge acceptée par le garant"
                          : t.privateConfig.guarantorStatus === "REJECTED"
                          ? "✕ Accord refusé par le garant"
                          : "⏳ Accord du garant en attente"}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-700 pt-1 border-t border-slate-200/60">
                      <div>
                        <span className="text-slate-400 text-[10px] uppercase font-bold block">Membre garant</span>
                        <strong className="text-slate-900">{t.privateConfig.guarantorName}</strong>
                        {t.privateConfig.guarantorPhone && (
                          <span className="text-slate-500 block text-[11px]">📞 {t.privateConfig.guarantorPhone}</span>
                        )}
                      </div>
                      <div>
                        <span className="text-slate-400 text-[10px] uppercase font-bold block">Cotisation publique garant</span>
                        <span className="text-slate-800 font-semibold">
                          {(t.privateConfig.guarantorPublicSession as string) || "Cotisation publique DIVA Asso"}
                        </span>
                      </div>
                    </div>
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

                {/* Emergency Fund Dashboard & Contribution Card (Section 10) */}
                {t.emergencyFund && (
                  <div className="p-3.5 rounded-2xl bg-gradient-to-r from-amber-50 to-emerald-50 border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-amber-700 text-[18px]">emergency</span>
                        <strong className="text-xs font-extrabold text-slate-900">{t.emergencyFund.name}</strong>
                      </div>
                      <p className="text-[11px] text-slate-600 mt-0.5">
                        Minimum par versement : <strong>{formatXAF(t.emergencyFund.minimumAmount)}</strong> · Total collecté :{" "}
                        <strong className="text-emerald-800">
                          {formatXAF(t.emergencyFund.contributions.reduce((acc, c) => acc + c.amount, 0))}
                        </strong>{" "}
                        ({t.emergencyFund.contributions.length} versement(s))
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setContributeFundId(t.id);
                        setContributeAmountInput(String(t.emergencyFund?.minimumAmount || 1000));
                      }}
                      className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs cursor-pointer flex-shrink-0"
                    >
                      Contribuer à la caisse
                    </button>
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

                      {/* Transfer Ownership Button (Section 11) */}
                      <button
                        type="button"
                        onClick={() => setTransferTontineId(t.id)}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-amber-300 text-amber-900 hover:bg-amber-50 cursor-pointer flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-[15px]">swap_horiz</span>
                        <span>Transférer la gestion</span>
                      </button>

                      {/* Restart Closed Cycle Button (Section 12.2) */}
                      {t.status === "CLOSED" && (
                        <button
                          type="button"
                          disabled={busyAction !== null}
                          onClick={() => {
                            if (!window.confirm("Relancer un nouveau cycle pour cette cotisation fermée ?")) return;
                            runManageAction(
                              t.id,
                              { action: "restart_cycle" },
                              `${t.id}-restart`,
                              "Nouveau cycle créé avec succès !",
                            );
                          }}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-800 text-white hover:bg-emerald-900 cursor-pointer flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined text-[15px]">restart_alt</span>
                          <span>Relancer nouveau cycle</span>
                        </button>
                      )}

                      {/* Safe Delete Session (Section 12.1) */}
                      {t.status === "CLOSED" && (
                        <button
                          type="button"
                          disabled={busyAction !== null}
                          onClick={() => {
                            if (!window.confirm("Supprimer définitivement cette cotisation fermée ?")) return;
                            runManageAction(
                              t.id,
                              { action: "delete_session" },
                              `${t.id}-delete`,
                              "Cotisation supprimée.",
                            );
                          }}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-600 text-white hover:bg-red-700 cursor-pointer flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined text-[15px]">delete</span>
                          <span>Supprimer</span>
                        </button>
                      )}

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
                                    if (!window.confirm(`Retirer ${s.membership.userName} de cette cotisation ?`)) return;
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
    </>
  )}

      {/* ── Onglet Personnes Cautionnées (Engagements de Garant) ── */}
      {activeTab === "GUARANTEED_MEMBERS" && (
        <div className="flex flex-col gap-4">
          <div className="p-4 rounded-2xl bg-emerald-50/70 border border-emerald-200/80 text-xs text-emerald-950 flex items-start gap-2.5">
            <span className="material-symbols-outlined text-emerald-700 text-[22px] flex-shrink-0">
              verified
            </span>
            <div>
              <strong className="block font-bold">
                {lang === "fr"
                  ? "Vos engagements de caution solidaire"
                  : "Your Solidarity Guarantee Engagements"}
              </strong>
              <p className="text-[11px] text-emerald-800 mt-0.5 leading-relaxed">
                {lang === "fr"
                  ? "En tant que membre d'une cotisation publique DIVA Asso, vous vous êtes porté garant pour les personnes ci-dessous lors de la création de leur cotisation privée. Vous pouvez suivre ici l'état d'avancement de leur dossier et les membres validés."
                  : "As an active member of a public DIVA Asso tontine, you agreed to guarantee the members below for their private tontine."}
              </p>
            </div>
          </div>

          {guaranteedEngagements.length === 0 ? (
            <div className="bg-white rounded-3xl p-10 text-center border border-slate-200/80 flex flex-col items-center gap-3">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-500 flex items-center justify-center">
                <span className="material-symbols-outlined text-3xl">shield_person</span>
              </div>
              <h3 className="font-bold text-base text-slate-900">
                Aucune personne cautionnée pour le moment
              </h3>
              <p className="text-xs text-slate-500 max-w-sm">
                Lorsqu&apos;un membre créateur vous désigne comme garant et que vous acceptez sa demande, il apparaîtra ici avec l&apos;ensemble des informations de sa cotisation.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {guaranteedEngagements.map((eng) => (
                <div
                  key={eng.sessionId}
                  className="bg-white rounded-3xl p-5 shadow-sm border border-slate-200/80 flex flex-col gap-3.5"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      {eng.creatorPhotoUrl ? (
                        <div className="w-12 h-12 rounded-2xl overflow-hidden border border-slate-200 flex-shrink-0 bg-slate-100">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={eng.creatorPhotoUrl}
                            alt={eng.creatorName}
                            className="w-full h-full object-cover"
                          />
                        </div>
                      ) : (
                        <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-900 flex items-center justify-center font-extrabold text-base flex-shrink-0">
                          {eng.creatorName.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 text-[10px] font-bold">
                            ✓ Caution acceptée
                          </span>
                          {eng.privateApprovalStatus === "APPROVED" && (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-950 text-[10px] font-bold">
                              ✓ Validée par DIVA Asso
                            </span>
                          )}
                          {eng.privateApprovalStatus === "PENDING_ADMIN" && (
                            <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-950 text-[10px] font-bold">
                              ⏳ Examen admin DIVA Asso
                            </span>
                          )}
                          {eng.privateApprovalStatus === "REJECTED" && (
                            <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-900 text-[10px] font-bold">
                              ✕ Rejetée par l&apos;admin
                            </span>
                          )}
                        </div>
                        <h4 className="text-base font-extrabold text-slate-900 mt-1">
                          {eng.creatorName}
                        </h4>
                        {eng.creatorPhone && (
                          <p className="text-xs text-slate-500 font-semibold mt-0.5">
                            📞 {eng.creatorPhone}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="text-right sm:self-start">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">
                        Cotisation privée
                      </span>
                      <strong className="text-sm text-slate-900 block">
                        « {eng.sessionTitle} »
                      </strong>
                      <span className="text-xs text-emerald-800 font-extrabold">
                        {formatXAF(eng.amount)}
                      </span>
                    </div>
                  </div>

                  <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80 text-xs text-slate-700 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[16px] text-emerald-700">
                        verified_user
                      </span>
                      <span>
                        Engagement validé le :{" "}
                        <strong className="text-slate-900">
                          {eng.guarantorRespondedAt
                            ? formatDateFr(eng.guarantorRespondedAt)
                            : "Récemment"}
                        </strong>
                      </span>
                    </div>
                    <div className="text-slate-500">
                      Membres participants : <strong className="text-slate-900">{eng.approvedMembersCount}</strong>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Transfer Ownership Modal */}
      {transferTontineId && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => setTransferTontineId(null)}
        >
          <div
            className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-extrabold text-slate-900">Transférer la gestion</h3>
              <button
                type="button"
                onClick={() => setTransferTontineId(null)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Sélectionnez un membre approuvé de cette cotisation pour lui transférer la propriété et la gestion.
            </p>
            {(() => {
              const currentT = tontines.find((x) => x.id === transferTontineId);
              const eligibleMembers = currentT?.memberships.filter(
                (m) => m.status === "APPROVED" && m.userId !== currentUserId,
              ) || [];

              if (eligibleMembers.length === 0) {
                return (
                  <p className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-950 font-semibold">
                    Aucun autre membre approuvé disponible pour recevoir la gestion.
                  </p>
                );
              }

              return (
                <div className="flex flex-col gap-3">
                  <select
                    value={transferTargetUserId}
                    onChange={(e) => setTransferTargetUserId(e.target.value)}
                    className="border-2 border-emerald-600 rounded-xl p-2.5 text-xs bg-white"
                  >
                    <option value="">Sélectionnez le nouveau gestionnaire...</option>
                    {eligibleMembers.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.userName} {m.userPhone ? `(${m.userPhone})` : ""}
                      </option>
                    ))}
                  </select>
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setTransferTontineId(null)}
                      className="px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 cursor-pointer"
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      disabled={!transferTargetUserId || busyAction !== null}
                      onClick={() => {
                        runManageAction(
                          transferTontineId,
                          { action: "transfer_ownership", targetUserId: transferTargetUserId },
                          `transfer-${transferTontineId}`,
                          "Gestion transférée avec succès !",
                        );
                      }}
                      className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                    >
                      Confirmer le transfert
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Emergency Fund Contribution Modal */}
      {contributeFundId && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => setContributeFundId(null)}
        >
          <div
            className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-extrabold text-slate-900">
                Contribuer à la caisse de secours
              </h3>
              <button
                type="button"
                onClick={() => setContributeFundId(null)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <p className="text-xs text-slate-600">
              Votre contribution sera débitée directement de votre portefeuille DIVA Asso et reversée sur le compte de la caisse de secours.
            </p>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Montant (FCFA)</label>
              <input
                type="text"
                inputMode="numeric"
                value={contributeAmountInput}
                onChange={(e) => setContributeAmountInput(sanitizeNumericInput(e.target.value))}
                placeholder="Ex: 1 000 FCFA"
                className="w-full border-2 border-emerald-600 rounded-xl p-2.5 text-sm font-bold bg-white"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setContributeFundId(null)}
                className="px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => handleContributeEmergencyFund(contributeFundId)}
                className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                Valider la contribution
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
