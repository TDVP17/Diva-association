"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { translate, type Lang } from "@/lib/i18n/translations";
import { getCycleDateForRound } from "@/lib/tontine-engine";
import type { TontineType } from "@/generated/prisma/enums";
import { NotificationsTab } from "./notifications-tab";
import { ActivityTab } from "./activity-tab";
import { MemberArchivesToggle } from "@/components/admin/member-archives-toggle";

interface MembershipRequest {
  id: string;
  joinedAt: string;
  user: { id: string; name: string; avatar: string | null; image: string | null };
  tontineSession: { id: string; title: string | null; type: string; status: string };
  kycVerification: {
    documentType: string;
    matchConfidence: number | null;
    documentImageUrl: string | null;
    verifiedAt: string | null;
  } | null;
}

interface AdminSlot {
  id: string;
  membershipId: string;
  userId: string;
  beneficiaryName: string;
  name: string;
  memberCode: string | null;
  avatar: string | null;
  hasPhone: boolean;
  officialPosition: number | null;
  ballDrawn: number | null;
  paidThisCycle: boolean;
}

interface AdminSession {
  id: string;
  title: string | null;
  description: string | null;
  type: string;
  status: string;
  amount: number;
  fee: number;
  fineAmountPerPeriod: number | null;
  fineIntervalHours: number | null;
  limitTime: string;
  startDate: string;
  drawDate: string | null;
  maxSlots: number | null;
  isPaused: boolean;
  lockedAt: string | null;
  registeredSlots: number;
  slots: AdminSlot[];
}

interface Ledger {
  totalFees: number;
  totalUnpaidFines: number;
  feeSplit: { president: number; winner: number } | null;
}

interface PayoutClaim {
  id: string;
  status: "DETAILS_SUBMITTED" | "RELEASED" | "CONFIRMED";
  beneficiaryName: string;
  memberName: string;
  payoutPhone: string;
  payoutAccountName: string;
  netPayout: number | null;
  detailsSubmittedAt: string;
  releasedAt: string | null;
  memberConfirmedAt: string | null;
  confirmedByAdmin: boolean;
}

interface Transaction {
  id: string;
  beneficiaryName: string;
  memberName: string;
  paidByName: string | null;
  amount: number;
  status: string;
  dueDate: string;
  paidAt: string | null;
  transRef: string;
}

interface FineRow {
  id: string;
  beneficiaryName: string;
  memberName: string;
  amount: number;
  status: string;
  dueDate: string;
}

const TABS = ["overview", "members", "payments", "foodTurn", "fines", "notifications", "activity"] as const;
type Tab = (typeof TABS)[number];

export function ContributionDetailClient({ tontineSessionId, lang }: { tontineSessionId: string; lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [session, setSession] = useState<AdminSession | null>(null);
  const [order, setOrder] = useState<AdminSlot[]>([]);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [payoutClaims, setPayoutClaims] = useState<PayoutClaim[]>([]);
  const [reviewingClaimId, setReviewingClaimId] = useState<string | null>(null);
  const [payoutResult, setPayoutResult] = useState<string | null>(null);
  const [payoutPreview, setPayoutPreview] = useState<{
    pot: number;
    deducted: number;
    netPayout: number;
    beneficiaryName: string;
    memberName: string;
    payoutPhone: string;
    payoutAccountName: string;
  } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [confirmingOverrideId, setConfirmingOverrideId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [startingDraw, setStartingDraw] = useState(false);
  const [contributionSlotId, setContributionSlotId] = useState<string>("");
  const [contributionResult, setContributionResult] = useState<string | null>(null);
  const [recordingContribution, setRecordingContribution] = useState(false);
  const [userQuery, setUserQuery] = useState("");
  const [userResults, setUserResults] = useState<{ id: string; name: string; email: string }[]>([]);
  const [selectedUser, setSelectedUser] = useState<{ id: string; name: string } | null>(null);
  const [addSlotCount, setAddSlotCount] = useState(1);
  const [addNames, setAddNames] = useState<string[]>([""]);
  const [addingMember, setAddingMember] = useState(false);
  const [addMemberResult, setAddMemberResult] = useState<string | null>(null);
  const [membershipQueue, setMembershipQueue] = useState<MembershipRequest[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [fines, setFines] = useState<FineRow[]>([]);

  const [showEditModal, setShowEditModal] = useState(false);
  const [editFields, setEditFields] = useState<{
    title: string;
    description: string;
    amount: string;
    fee: string;
    fineAmountPerPeriod: string;
    fineIntervalHours: string;
    startDate: string;
    drawDate: string;
    limitTime: string;
    maxSlots: string;
  } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [pausing, setPausing] = useState(false);
  const [locking, setLocking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const refreshSession = useCallback(async () => {
    const s: AdminSession = await fetch(`/api/admin/sessions/${tontineSessionId}`).then((r) => r.json());
    if (!s.id) return;
    setSession(s);
    setOrder(s.slots);
  }, [tontineSessionId]);

  // Initial load. Inlined (rather than calling refreshSession) so each
  // fetch's setState lives directly in a `.then`, avoiding the
  // set-state-in-effect lint rule that a bare async-function call trips.
  useEffect(() => {
    fetch(`/api/admin/sessions/${tontineSessionId}`)
      .then((r) => r.json())
      .then((s: AdminSession) => {
        if (!s.id) return;
        setSession(s);
        setOrder(s.slots);
      });
    fetch(`/api/admin/sessions/${tontineSessionId}/ledger`)
      .then((r) => r.json())
      .then(setLedger);
    fetch(`/api/admin/sessions/${tontineSessionId}/payout-claims`)
      .then((r) => r.json())
      .then((b) => setPayoutClaims(b.claims ?? []));
    fetch(`/api/admin/membership-queue?tontineSessionId=${tontineSessionId}`)
      .then((r) => r.json())
      .then((b) => setMembershipQueue(b.memberships ?? []));
    fetch(`/api/admin/transactions?tontineSessionId=${tontineSessionId}`)
      .then((r) => r.json())
      .then((b) => setTransactions(b.transactions ?? []));
    fetch(`/api/admin/sessions/${tontineSessionId}/fines`)
      .then((r) => r.json())
      .then((b) => setFines(b.fines ?? []));
  }, [tontineSessionId]);

  useEffect(() => {
    if (!userQuery.trim() || selectedUser) return;
    const handle = setTimeout(() => {
      fetch(`/api/admin/users/search?q=${encodeURIComponent(userQuery.trim())}`)
        .then((r) => r.json())
        .then((b) => setUserResults(b.users ?? []));
    }, 300);
    return () => clearTimeout(handle);
  }, [userQuery, selectedUser]);
  const visibleUserResults = !selectedUser && userQuery.trim() ? userResults : [];

  async function decideMembership(request: MembershipRequest, action: "approve" | "reject") {
    let reason: string | null = null;
    if (action === "reject") {
      reason = window.prompt(t("rejectionReasonLabel"), "");
      if (reason === null) return;
    }
    setMembershipQueue((q) => q.filter((m) => m.id !== request.id));
    const res = await fetch(`/api/admin/membership/${request.id}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, reason: reason || undefined }),
    });
    if (!res.ok) {
      setMembershipQueue((q) => [...q, request]);
      window.alert(t("couldNotUpdateMembership"));
    } else {
      await refreshSession();
    }
  }

  function moveItem(from: number, to: number) {
    if (to < 0 || to >= order.length) return;
    setOrder((current) => {
      const next = [...current];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  async function publishRanking() {
    setPublishing(true);
    try {
      const res = await fetch(`/api/admin/sessions/${tontineSessionId}/publish-ranking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: order.map((m) => m.id) }),
      });
      if (res.ok) await refreshSession();
    } finally {
      setPublishing(false);
    }
  }

  async function startDrawingPhase() {
    setStartingDraw(true);
    try {
      const res = await fetch(`/api/admin/sessions/${tontineSessionId}/start-drawing`, { method: "POST" });
      if (res.ok) await refreshSession();
    } finally {
      setStartingDraw(false);
    }
  }

  async function recordManualContribution() {
    if (!contributionSlotId) return;
    setRecordingContribution(true);
    setContributionResult(null);
    try {
      const res = await fetch("/api/admin/contributions/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membershipSlotId: contributionSlotId }),
      });
      const body = await res.json();
      if (!res.ok) {
        if (body?.error) console.error("[recordContribution] server error:", body.error);
        setContributionResult(t("couldNotRecordContribution"));
        return;
      }
      setContributionResult(t("contributionRecorded"));
      setContributionSlotId("");
      await refreshSession();
      fetch(`/api/admin/sessions/${tontineSessionId}/ledger`).then((r) => r.json()).then(setLedger);
      fetch(`/api/admin/transactions?tontineSessionId=${tontineSessionId}`)
        .then((r) => r.json())
        .then((b) => setTransactions(b.transactions ?? []));
    } finally {
      setRecordingContribution(false);
    }
  }

  async function refreshPayoutClaims() {
    const body = await fetch(`/api/admin/sessions/${tontineSessionId}/payout-claims`).then((r) => r.json());
    setPayoutClaims(body.claims ?? []);
  }

  async function reviewClaim(claimId: string) {
    setReviewingClaimId(claimId);
    setLoadingPreview(true);
    setPayoutResult(null);
    setPayoutPreview(null);
    try {
      const res = await fetch(`/api/admin/payouts/preview?payoutClaimId=${claimId}`);
      const body = await res.json();
      if (!res.ok) {
        if (body?.error) console.error("[reviewClaim] server error:", body.error);
        setPayoutResult(t("failedToReleasePayout"));
        return;
      }
      setPayoutPreview(body);
    } finally {
      setLoadingPreview(false);
    }
  }

  async function confirmReleasePayout() {
    if (!reviewingClaimId) return;
    setReleasing(true);
    setPayoutResult(null);
    try {
      const res = await fetch("/api/admin/payouts/release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payoutClaimId: reviewingClaimId }),
      });
      const body = await res.json();
      if (!res.ok) {
        if (body?.error) console.error("[confirmReleasePayout] server error:", body.error);
        setPayoutResult(t("failedToReleasePayout"));
        return;
      }
      setPayoutResult(
        t("payoutResultLine", {
          pot: body.pot.toLocaleString("en-US"),
          deducted: body.deducted.toLocaleString("en-US"),
          net: body.netPayout.toLocaleString("en-US"),
        }),
      );
      setPayoutPreview(null);
      setReviewingClaimId(null);
      await refreshPayoutClaims();
      fetch(`/api/admin/sessions/${tontineSessionId}/ledger`).then((r) => r.json()).then(setLedger);
    } finally {
      setReleasing(false);
    }
  }

  async function confirmOverride(claimId: string) {
    setConfirmingOverrideId(claimId);
    try {
      const res = await fetch(`/api/admin/payouts/${claimId}/confirm-override`, { method: "POST" });
      if (res.ok) await refreshPayoutClaims();
    } finally {
      setConfirmingOverrideId(null);
    }
  }

  function handleAddSlotCountChange(next: number) {
    setAddSlotCount(next);
    setAddNames((current) => {
      const copy = current.slice(0, next);
      while (copy.length < next) copy.push("");
      return copy;
    });
  }

  async function addMemberManually() {
    if (!selectedUser || addNames.some((n) => !n.trim())) return;
    setAddingMember(true);
    setAddMemberResult(null);
    try {
      const res = await fetch("/api/admin/memberships/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: selectedUser.id,
          tontineSessionId,
          slotCount: addSlotCount,
          beneficiaryNames: addNames.map((n) => n.trim()),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        if (body?.error) console.error("[addMember] server error:", body.error);
        setAddMemberResult(t("couldNotAddMember"));
        return;
      }
      setAddMemberResult(t("memberAddedSuccessfully"));
      setSelectedUser(null);
      setUserQuery("");
      setAddSlotCount(1);
      setAddNames([""]);
      await refreshSession();
    } finally {
      setAddingMember(false);
    }
  }

  function openEditModal() {
    if (!session) return;
    setEditFields({
      title: session.title ?? "",
      description: session.description ?? "",
      amount: String(session.amount),
      fee: String(session.fee),
      fineAmountPerPeriod: String(session.fineAmountPerPeriod ?? ""),
      fineIntervalHours: String(session.fineIntervalHours ?? ""),
      startDate: session.startDate.slice(0, 10),
      drawDate: session.drawDate ? session.drawDate.slice(0, 10) : "",
      limitTime: session.limitTime,
      maxSlots: session.maxSlots !== null ? String(session.maxSlots) : "",
    });
    setEditError(null);
    setShowEditModal(true);
  }

  async function saveEdit() {
    if (!editFields) return;
    setSavingEdit(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/admin/sessions/${tontineSessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editFields.title,
          description: editFields.description || undefined,
          amount: Number(editFields.amount),
          fee: Number(editFields.fee),
          fineAmountPerPeriod: Number(editFields.fineAmountPerPeriod),
          fineIntervalHours: Number(editFields.fineIntervalHours),
          startDate: editFields.startDate,
          drawDate: editFields.drawDate,
          limitTime: editFields.limitTime,
          maxSlots: editFields.maxSlots ? Number(editFields.maxSlots) : null,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        if (body?.error) console.error("[saveEdit] server error:", body.error);
        setEditError(t("couldNotUpdateCotisation"));
        return;
      }
      setShowEditModal(false);
      await refreshSession();
    } finally {
      setSavingEdit(false);
    }
  }

  async function togglePause() {
    if (!session) return;
    setPausing(true);
    try {
      const res = await fetch(`/api/admin/sessions/${tontineSessionId}/pause`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: !session.isPaused }),
      });
      if (res.ok) await refreshSession();
    } finally {
      setPausing(false);
    }
  }

  async function lockSession() {
    if (!window.confirm(t("lockConfirmMessage"))) return;
    setLocking(true);
    try {
      const res = await fetch(`/api/admin/sessions/${tontineSessionId}/lock`, { method: "POST" });
      if (res.ok) await refreshSession();
      else window.alert(t("couldNotLockCotisation"));
    } finally {
      setLocking(false);
    }
  }

  async function deleteSession() {
    if (!window.confirm(t("deleteConfirmMessage"))) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/admin/sessions/${tontineSessionId}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body?.error) console.error("[deleteSession] server error:", body.error);
        setDeleteError(t("couldNotDeleteCotisation"));
        return;
      }
      router.push("/admin");
    } finally {
      setDeleting(false);
    }
  }

  if (!session) {
    return <main className="px-container-padding py-stack-gap-lg max-w-4xl mx-auto">…</main>;
  }

  const drawUnlocked = session.drawDate ? new Date() >= new Date(session.drawDate) : false;
  const drawUnlocksAtLabel = session.drawDate
    ? new Date(session.drawDate).toLocaleString("en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "";
  const sessionLabel = session.title || session.type;

  const TAB_LABELS: Record<Tab, string> = {
    overview: t("overviewTab"),
    members: t("membersTab"),
    payments: t("paymentsTab"),
    foodTurn: t("foodTurnTab"),
    fines: t("finesTab"),
    notifications: t("notificationsTab"),
    activity: t("activityTab"),
  };
  const TAB_ICONS: Record<Tab, string> = {
    overview: "dashboard",
    members: "group",
    payments: "payments",
    foodTurn: "restaurant",
    fines: "warning",
    notifications: "notifications",
    activity: "history",
  };
  const foodTurnActionCount = payoutClaims.filter((c) => c.status !== "CONFIRMED").length;

  return (
    <main className="px-container-padding pt-stack-gap-lg pb-32 max-w-4xl mx-auto w-full flex flex-col gap-stack-gap-lg">
      <div>
        <Link href="/admin" className="font-label-sm text-label-sm text-primary underline mb-2 inline-flex items-center gap-1">
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          {t("backToDashboard")}
        </Link>
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <h2 className="font-headline-lg-mobile text-headline-lg-mobile md:font-headline-lg md:text-headline-lg text-primary">
              {sessionLabel}
            </h2>
            {session.isPaused && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-secondary-container/40 text-on-secondary-container font-label-sm text-label-sm mt-1">
                {t("pausedBadge")}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-surface-variant">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex items-center gap-1.5 px-3 py-2 font-label-sm text-label-sm whitespace-nowrap border-b-2 transition-colors ${
              activeTab === tab
                ? "border-primary text-primary"
                : "border-transparent text-on-surface-variant hover:text-on-surface"
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">{TAB_ICONS[tab]}</span>
            {TAB_LABELS[tab]}
            {tab === "foodTurn" && foodTurnActionCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-error text-on-error font-label-sm text-[10px] leading-none">
                {foodTurnActionCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeTab === "overview" && (
        <div className="flex flex-col gap-stack-gap-lg">
          <div>
            <h3 className="font-title-md text-title-md text-primary flex items-center gap-2 mb-3">
              <span className="material-symbols-outlined">settings</span>
              {t("settingsTab")}
            </h3>
            <div className="flex items-center gap-2 flex-wrap">
              {session.status === "DRAFT" && (
              <button
                onClick={startDrawingPhase}
                disabled={startingDraw || !drawUnlocked}
                title={drawUnlocked ? undefined : t("drawUnlocksAt", { date: drawUnlocksAtLabel })}
                className="px-3 py-2 rounded-lg bg-primary text-on-primary font-label-sm text-label-sm hover:opacity-90 disabled:opacity-60"
              >
                {startingDraw ? t("startingEllipsis") : drawUnlocked ? t("startDrawingPhase") : t("drawUnlocksAt", { date: drawUnlocksAtLabel })}
              </button>
            )}
            <button
              onClick={openEditModal}
              className="px-3 py-2 rounded-lg border border-outline-variant text-on-surface font-label-sm text-label-sm hover:bg-surface flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-[16px]">edit</span>
              {t("editCotisation")}
            </button>
            <button
              onClick={togglePause}
              disabled={pausing}
              className="px-3 py-2 rounded-lg border border-outline-variant text-on-surface font-label-sm text-label-sm hover:bg-surface disabled:opacity-60 flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-[16px]">{session.isPaused ? "play_arrow" : "pause"}</span>
              {session.isPaused ? t("resume") : t("pause")}
            </button>
            {!session.lockedAt && (
              <button
                onClick={lockSession}
                disabled={locking}
                className="px-3 py-2 rounded-lg border border-outline-variant text-on-surface font-label-sm text-label-sm hover:bg-surface disabled:opacity-60 flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[16px]">lock</span>
                {t("lock")}
              </button>
            )}
            <button
              onClick={deleteSession}
              disabled={deleting}
              className="px-3 py-2 rounded-lg border border-error/40 text-error font-label-sm text-label-sm hover:bg-error/5 disabled:opacity-60 flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-[16px]">delete</span>
              {t("delete")}
            </button>
            </div>
          </div>
          {deleteError && <p className="font-label-sm text-label-sm text-error">{deleteError}</p>}

          <section className="bg-surface rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] p-4 flex flex-col h-full">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-title-md text-title-md text-primary flex items-center gap-2">
                <span className="material-symbols-outlined">format_list_numbered</span>
                {t("payoutOrder")}
              </h3>
            </div>
            <p className="font-label-sm text-label-sm text-on-surface-variant mb-4">{t("dragToReorder")}</p>
            <div className="flex-grow flex flex-col gap-2 mb-4">
              {order.map((m, index) => (
                <div
                  key={m.id}
                  draggable
                  onDragStart={() => setDragIndex(index)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragIndex !== null && dragIndex !== index) moveItem(dragIndex, index);
                    setDragIndex(null);
                  }}
                  className="flex items-center bg-surface-container-lowest border border-outline-variant/50 p-3 rounded-lg shadow-sm cursor-grab active:cursor-grabbing hover:bg-surface-container-low transition-colors"
                >
                  <span className="material-symbols-outlined text-outline mr-3">drag_indicator</span>
                  <div className="w-8 h-8 rounded bg-secondary-fixed-dim/30 text-on-secondary-fixed-variant flex items-center justify-center font-label-md text-label-md mr-3 font-bold">
                    {index + 1}
                  </div>
                  <div className="flex-grow min-w-0">
                    <p className="font-label-md text-label-md text-on-surface truncate">{m.beneficiaryName}</p>
                    <p className="font-label-sm text-label-sm text-on-surface-variant truncate">
                      {m.name}
                      {` — ~${getCycleDateForRound(session.type as TontineType, new Date(session.startDate), index + 1).toLocaleDateString("en-US", { day: "numeric", month: "short" })}`}
                    </p>
                    {!m.hasPhone && <p className="font-label-sm text-label-sm text-error">{t("noWhatsappOnFile")}</p>}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <button
                      aria-label={t("moveUp")}
                      onClick={() => moveItem(index, index - 1)}
                      className="text-outline hover:text-primary disabled:opacity-30"
                      disabled={index === 0}
                    >
                      <span className="material-symbols-outlined text-[18px]">keyboard_arrow_up</span>
                    </button>
                    <button
                      aria-label={t("moveDown")}
                      onClick={() => moveItem(index, index + 1)}
                      className="text-outline hover:text-primary disabled:opacity-30"
                      disabled={index === order.length - 1}
                    >
                      <span className="material-symbols-outlined text-[18px]">keyboard_arrow_down</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={publishRanking}
              disabled={publishing || order.length === 0 || !drawUnlocked}
              title={drawUnlocked ? undefined : t("drawUnlocksAt", { date: drawUnlocksAtLabel })}
              className="w-full bg-primary text-on-primary font-label-md text-label-md py-3 rounded-lg hover:opacity-90 active:scale-95 transition-all shadow-sm mt-auto disabled:opacity-60"
            >
              {publishing ? t("publishingEllipsis") : drawUnlocked ? t("publishOfficialRanking") : t("drawUnlocksAt", { date: drawUnlocksAtLabel })}
            </button>
          </section>

          <section className="bg-primary text-on-primary rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] p-4 relative overflow-hidden">
            <h3 className="font-title-md text-title-md flex items-center gap-2 mb-4 relative z-10">
              <span className="material-symbols-outlined">account_balance</span>
              {t("financialLedger")}
            </h3>
            <div className="mb-4 relative z-10">
              <p className="font-label-sm text-label-sm text-primary-fixed-dim">{t("totalCollectedFees")}</p>
              <p className="font-numeric-data text-numeric-data text-white">{(ledger?.totalFees ?? 0).toLocaleString("en-US")} F</p>
            </div>
            {ledger?.feeSplit && (
              <div className="bg-on-primary-fixed-variant/50 rounded-lg p-3 mb-4 backdrop-blur-sm relative z-10">
                <div className="flex justify-between items-center border-b border-primary-fixed-dim/20 pb-2 mb-2">
                  <span className="font-label-sm text-label-sm text-primary-fixed-dim">{t("presidentLabel")}</span>
                  <span className="font-label-md text-label-md text-white">{ledger.feeSplit.president.toLocaleString("en-US")} F</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-label-sm text-label-sm text-primary-fixed-dim">{t("winnerLabel")}</span>
                  <span className="font-label-md text-label-md text-white">{ledger.feeSplit.winner.toLocaleString("en-US")} F</span>
                </div>
              </div>
            )}
            <div className="flex justify-between items-center bg-surface-container-lowest text-on-surface rounded-lg p-3 relative z-10 shadow-sm">
              <div className="flex items-center gap-2 text-error">
                <span className="material-symbols-outlined text-[20px]">warning</span>
                <span className="font-label-md text-label-md font-bold">{t("unpaidFines")}</span>
              </div>
              <span className="font-numeric-data text-[18px] text-on-surface">{(ledger?.totalUnpaidFines ?? 0).toLocaleString("en-US")} F</span>
            </div>
          </section>
        </div>
      )}

      {activeTab === "members" && (
        <div className="flex flex-col gap-stack-gap-lg">
          <section>
            <div className="flex justify-between items-end mb-stack-gap-md">
              <h3 className="font-title-md text-title-md text-primary flex items-center gap-2">
                <span className="material-symbols-outlined">group_add</span>
                {t("pendingMembershipRequests")}
              </h3>
              {membershipQueue.length > 0 && (
                <span className="bg-error/10 text-error font-label-sm text-label-sm px-2 py-0.5 rounded-full">
                  {membershipQueue.length} {t("actionRequired")}
                </span>
              )}
            </div>
            {membershipQueue.length === 0 ? (
              <p className="font-label-sm text-label-sm text-on-surface-variant">{t("noPendingRequests")}</p>
            ) : (
              <div className="flex flex-col gap-0 border border-outline-variant/30 rounded-lg overflow-hidden">
                {membershipQueue.map((m) => (
                  <div key={m.id} className="flex items-center justify-between p-3 bg-surface-container-lowest border-b last:border-b-0 border-outline-variant/30">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-full bg-tertiary-container text-on-tertiary flex items-center justify-center font-label-md text-label-md overflow-hidden flex-shrink-0">
                        {m.user.avatar ?? m.user.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={m.user.avatar ?? m.user.image!} alt={m.user.name} className="w-full h-full object-cover" />
                        ) : (
                          m.user.name.slice(0, 2).toUpperCase()
                        )}
                      </div>
                      <p className="font-label-md text-label-md text-on-surface truncate">{m.user.name}</p>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <button onClick={() => decideMembership(m, "reject")} className="px-2 py-1 rounded border border-outline-variant text-on-surface-variant font-label-sm text-label-sm hover:bg-surface">
                        {t("reject")}
                      </button>
                      <button onClick={() => decideMembership(m, "approve")} className="px-2 py-1 rounded bg-primary text-on-primary font-label-sm text-label-sm hover:opacity-90">
                        {t("approve")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h3 className="font-title-md text-title-md text-primary flex items-center gap-2 mb-stack-gap-md">
              <span className="material-symbols-outlined">group</span>
              {t("membersLabel")} ({session.slots.filter((s) => s.paidThisCycle).length}/{session.slots.length})
            </h3>
            <div className="bg-surface rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-outline-variant/30 overflow-hidden">
              {session.slots.map((s, i) => (
                <div key={s.id} className={`flex items-center justify-between p-3 ${i < session.slots.length - 1 ? "border-b border-outline-variant/30" : ""}`}>
                  <div className="min-w-0">
                    <p className="font-label-md text-label-md text-on-surface truncate">{s.beneficiaryName}</p>
                    <p className="font-label-sm text-label-sm text-on-surface-variant truncate">
                      {s.name}
                      {s.memberCode && ` · ${s.memberCode}`}
                    </p>
                    <MemberArchivesToggle userId={s.userId} lang={lang} />
                  </div>
                  <span
                    className={`inline-flex items-center px-2 py-1 rounded-md font-label-sm text-label-sm flex-shrink-0 ml-2 ${
                      s.paidThisCycle ? "bg-[#d1fae5] text-[#065f46]" : "bg-secondary-fixed text-on-secondary-fixed-variant"
                    }`}
                  >
                    {s.paidThisCycle ? t("paidStatus") : t("unpaidStatus")}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="bg-surface rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] p-4">
            <h3 className="font-title-md text-title-md text-primary flex items-center gap-2 mb-4">
              <span className="material-symbols-outlined">person_add</span>
              {t("addMemberManually")}
            </h3>
            {!selectedUser ? (
              <div className="relative mb-3">
                <input
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                  placeholder={t("searchUserPlaceholder")}
                  className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md bg-white"
                />
                {visibleUserResults.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full bg-white border border-outline-variant rounded-lg shadow-md overflow-hidden">
                    {visibleUserResults.map((u) => (
                      <button
                        key={u.id}
                        onClick={() => {
                          setSelectedUser(u);
                          setUserResults([]);
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-surface-container-low"
                      >
                        <p className="font-label-md text-label-md text-on-surface">{u.name}</p>
                        <p className="font-label-sm text-label-sm text-on-surface-variant">{u.email}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-3 mb-3">
                <div className="flex items-center justify-between bg-surface-container-lowest rounded-lg px-3 py-2">
                  <span className="font-label-md text-label-md text-on-surface">{selectedUser.name}</span>
                  <button onClick={() => setSelectedUser(null)} className="text-outline hover:text-error" aria-label={t("cancel")}>
                    <span className="material-symbols-outlined text-[18px]">close</span>
                  </button>
                </div>
                <select
                  value={addSlotCount}
                  onChange={(e) => handleAddSlotCountChange(Number(e.target.value))}
                  className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md bg-white"
                >
                  {[1, 2, 3, 4, 5].map((opt) => (
                    <option key={opt} value={opt}>
                      {opt} {opt !== 1 ? t("slots") : t("slot")}
                    </option>
                  ))}
                </select>
                {addNames.map((name, i) => (
                  <input
                    key={i}
                    value={name}
                    onChange={(e) => setAddNames((current) => current.map((n, idx) => (idx === i ? e.target.value : n)))}
                    placeholder={`${t("beneficiaryName")} — ${t("slot")} ${i + 1}`}
                    className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
                  />
                ))}
                <button
                  onClick={addMemberManually}
                  disabled={addingMember || addNames.some((n) => !n.trim())}
                  className="w-full bg-primary text-on-primary font-label-md text-label-md py-2.5 rounded-lg hover:opacity-90 disabled:opacity-50"
                >
                  {addingMember ? t("recordingEllipsis") : t("addMemberManually")}
                </button>
              </div>
            )}
            {addMemberResult && <p className="font-label-sm text-label-sm text-on-surface-variant">{addMemberResult}</p>}
          </section>
        </div>
      )}

      {activeTab === "payments" && (
        <div className="flex flex-col gap-stack-gap-lg">
          <section className="bg-surface rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] p-4">
            <h3 className="font-title-md text-title-md text-primary flex items-center gap-2 mb-4">
              <span className="material-symbols-outlined">edit_note</span>
              {t("recordManualContribution")}
            </h3>
            <div className="flex gap-2 mb-3">
              <select
                value={contributionSlotId}
                onChange={(e) => setContributionSlotId(e.target.value)}
                className="flex-1 border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md bg-white"
              >
                <option value="">{t("selectSlotEllipsis")}</option>
                {session.slots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.beneficiaryName} ({s.name})
                  </option>
                ))}
              </select>
              <button
                onClick={recordManualContribution}
                disabled={!contributionSlotId || recordingContribution}
                className="bg-primary text-on-primary font-label-md text-label-md px-4 rounded-lg hover:opacity-90 disabled:opacity-50"
              >
                {recordingContribution ? t("recordingEllipsis") : t("recordPaid")}
              </button>
            </div>
            {contributionResult && <p className="font-label-sm text-label-sm text-on-surface-variant">{contributionResult}</p>}
          </section>

          <section className="bg-surface rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] p-4">
            <h3 className="font-title-md text-title-md text-primary flex items-center gap-2 mb-4">
              <span className="material-symbols-outlined">receipt_long</span>
              {t("transactionHistory")}
            </h3>
            {transactions.length === 0 ? (
              <p className="font-label-sm text-label-sm text-on-surface-variant">{t("noneYet")}</p>
            ) : (
              <div className="overflow-x-auto">
                <div className="flex flex-col gap-0 min-w-[480px]">
                  {transactions.map((tx, i) => (
                    <div key={tx.id} className={`flex items-center justify-between p-3 ${i < transactions.length - 1 ? "border-b border-outline-variant/30" : ""}`}>
                      <div className="min-w-0">
                        <p className="font-label-md text-label-md text-on-surface truncate">
                          {tx.beneficiaryName} ({tx.memberName})
                        </p>
                        <p className="font-label-sm text-label-sm text-on-surface-variant truncate">
                          {tx.paidByName && tx.paidByName !== tx.memberName ? `${t("paidByLabel")} ${tx.paidByName} · ` : ""}
                          {tx.paidAt ? new Date(tx.paidAt).toLocaleString("en-GB", { timeZone: "Africa/Douala" }) : t("pending")}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0 ml-2">
                        <p className="font-numeric-data text-[14px] text-on-surface">{tx.amount.toLocaleString("en-US")} F</p>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md font-label-sm text-label-sm ${
                            tx.status === "PAID" ? "bg-[#d1fae5] text-[#065f46]" : "bg-secondary-fixed text-on-secondary-fixed-variant"
                          }`}
                        >
                          {tx.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

        </div>
      )}

      {activeTab === "foodTurn" && (
        <section className="bg-surface rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] p-4">
          <h3 className="font-title-md text-title-md text-primary flex items-center gap-2 mb-4">
            <span className="material-symbols-outlined">restaurant</span>
            {t("foodTurnTab")}
          </h3>
          {payoutClaims.length === 0 ? (
            <p className="font-label-sm text-label-sm text-on-surface-variant">{t("noFoodTurnRequests")}</p>
          ) : (
            <div className="flex flex-col gap-3">
              {payoutClaims.map((c) => {
                const needsAction = c.status !== "CONFIRMED";
                return (
                  <div
                    key={c.id}
                    className={
                      needsAction
                        ? "rounded-lg p-4 flex flex-col gap-2 border-2 border-error/40 bg-error-container/20"
                        : "rounded-lg p-3 flex flex-col gap-2 bg-surface-container-lowest"
                    }
                  >
                    {needsAction && (
                      <div className="flex items-center gap-2 text-error font-label-sm text-label-sm font-bold">
                        <span className="material-symbols-outlined text-[18px]">warning</span>
                        {t("foodTurnActionRequired")}
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <p className="font-label-md text-label-md text-on-surface truncate">
                          {c.beneficiaryName} ({c.memberName})
                        </p>
                        <p className="font-label-sm text-label-sm text-on-surface-variant truncate">
                          {t("payoutAccountNameLabel")}: {c.payoutAccountName} — {c.payoutPhone}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0 ml-2">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md font-label-sm text-label-sm ${
                            c.status === "CONFIRMED" ? "bg-[#d1fae5] text-[#065f46]" : "bg-secondary-container/40 text-on-secondary-container"
                          }`}
                        >
                          {c.status}
                        </span>
                        {c.status === "CONFIRMED" && (
                          <p className="font-label-sm text-label-sm text-on-surface-variant mt-0.5">
                            {t("outstandingZero")}
                          </p>
                        )}
                      </div>
                    </div>
                    {c.status === "DETAILS_SUBMITTED" && reviewingClaimId !== c.id && (
                      <button
                        onClick={() => reviewClaim(c.id)}
                        disabled={loadingPreview}
                        className="bg-primary text-on-primary font-label-sm text-label-sm px-3 py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
                      >
                        {t("reviewAndExecute")}
                      </button>
                    )}
                    {c.status === "RELEASED" && (
                      <button
                        onClick={() => confirmOverride(c.id)}
                        disabled={confirmingOverrideId === c.id}
                        className="border border-outline-variant text-on-surface-variant font-label-sm text-label-sm px-3 py-2 rounded-lg hover:bg-surface disabled:opacity-50"
                      >
                        {t("markAsConfirmed")}
                      </button>
                    )}
                    {reviewingClaimId === c.id && payoutPreview && (
                      <div className="bg-white rounded-lg p-3 flex flex-col gap-2 border border-outline-variant">
                        <h4 className="font-label-md text-label-md text-on-surface">{t("payoutPreviewTitle")}</h4>
                        <div className="flex justify-between">
                          <span className="font-label-sm text-label-sm text-on-surface-variant">{t("beneficiaryOnFileLabel")}</span>
                          <span className="font-label-md text-label-md text-on-surface">
                            {payoutPreview.beneficiaryName} ({payoutPreview.memberName})
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="font-label-sm text-label-sm text-on-surface-variant">{t("amountToSendLabel")}</span>
                          <span className="font-numeric-data text-numeric-data text-primary">{payoutPreview.netPayout.toLocaleString("en-US")} F</span>
                        </div>
                        <p className="font-label-sm text-label-sm text-error">{t("onFileNotVerifiedNote")}</p>
                        <button
                          onClick={confirmReleasePayout}
                          disabled={releasing}
                          className="w-full bg-primary text-on-primary font-label-md text-label-md py-2.5 rounded-lg hover:opacity-90 disabled:opacity-50 mt-1"
                        >
                          {releasing ? t("recordingEllipsis") : t("confirmAndSend")}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {payoutResult && <p className="font-label-sm text-label-sm text-on-surface-variant mt-3">{payoutResult}</p>}
        </section>
      )}

      {activeTab === "fines" && (
        <section className="bg-surface rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] p-4">
          <h3 className="font-title-md text-title-md text-primary flex items-center gap-2 mb-4">
            <span className="material-symbols-outlined">warning</span>
            {t("finesTab")}
          </h3>
          {fines.length === 0 ? (
            <p className="font-label-sm text-label-sm text-on-surface-variant">{t("noneYet")}</p>
          ) : (
            <div className="flex flex-col gap-0 border border-outline-variant/30 rounded-lg overflow-hidden">
              {fines.map((f, i) => (
                <div key={f.id} className={`flex items-center justify-between p-3 bg-surface-container-lowest ${i < fines.length - 1 ? "border-b border-outline-variant/30" : ""}`}>
                  <div className="min-w-0">
                    <p className="font-label-md text-label-md text-on-surface truncate">
                      {f.beneficiaryName} ({f.memberName})
                    </p>
                    <p className="font-label-sm text-label-sm text-on-surface-variant">
                      {new Date(f.dueDate).toLocaleDateString("en-GB", { timeZone: "Africa/Douala" })}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0 ml-2">
                    <p className="font-numeric-data text-[14px] text-error">{f.amount.toLocaleString("en-US")} F</p>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-md font-label-sm text-label-sm ${
                        f.status === "UNPAID" ? "bg-error-container text-on-error-container" : "bg-[#d1fae5] text-[#065f46]"
                      }`}
                    >
                      {f.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {activeTab === "notifications" && (
        <NotificationsTab tontineSessionId={tontineSessionId} lang={lang} />
      )}

      {activeTab === "activity" && <ActivityTab tontineSessionId={tontineSessionId} lang={lang} />}

      {showEditModal && editFields && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-lg p-4 w-full max-w-md max-h-[90vh] overflow-y-auto flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="font-title-md text-title-md text-primary">{t("editCotisation")}</h3>
              <button onClick={() => setShowEditModal(false)} aria-label={t("cancel")}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div>
              <label className="font-label-sm text-label-sm text-on-surface-variant block mb-1">{t("title")}</label>
              <input
                value={editFields.title}
                onChange={(e) => setEditFields({ ...editFields, title: e.target.value })}
                className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
              />
            </div>
            <div>
              <label className="font-label-sm text-label-sm text-on-surface-variant block mb-1">{t("descriptionLabel")}</label>
              <textarea
                rows={2}
                value={editFields.description}
                onChange={(e) => setEditFields({ ...editFields, description: e.target.value })}
                className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-label-sm text-label-sm text-on-surface-variant block mb-1">{t("amountPerSlot")}</label>
                <input
                  type="number"
                  min="1"
                  value={editFields.amount}
                  onChange={(e) => setEditFields({ ...editFields, amount: e.target.value })}
                  className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
                />
              </div>
              <div>
                <label className="font-label-sm text-label-sm text-on-surface-variant block mb-1">{t("feePerSlot")}</label>
                <input
                  type="number"
                  min="0"
                  value={editFields.fee}
                  onChange={(e) => setEditFields({ ...editFields, fee: e.target.value })}
                  className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-label-sm text-label-sm text-on-surface-variant block mb-1">{t("fineAmountLabel")}</label>
                <input
                  type="number"
                  min="0"
                  value={editFields.fineAmountPerPeriod}
                  onChange={(e) => setEditFields({ ...editFields, fineAmountPerPeriod: e.target.value })}
                  className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
                />
              </div>
              <div>
                <label className="font-label-sm text-label-sm text-on-surface-variant block mb-1">{t("fineIntervalLabel")}</label>
                <input
                  type="number"
                  min="1"
                  value={editFields.fineIntervalHours}
                  onChange={(e) => setEditFields({ ...editFields, fineIntervalHours: e.target.value })}
                  className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
                />
              </div>
            </div>
            <div>
              <label className="font-label-sm text-label-sm text-on-surface-variant block mb-1">{t("maxSlotCapacity")}</label>
              <input
                type="number"
                min="0.5"
                step="0.5"
                value={editFields.maxSlots}
                onChange={(e) => setEditFields({ ...editFields, maxSlots: e.target.value })}
                placeholder={t("leaveBlankForNoLimit")}
                className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
              />
            </div>
            <div>
              <label className="font-label-sm text-label-sm text-on-surface-variant block mb-1">{t("startDate")}</label>
              <input
                type="date"
                value={editFields.startDate}
                onChange={(e) => setEditFields({ ...editFields, startDate: e.target.value })}
                className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
              />
            </div>
            <div>
              <label className="font-label-sm text-label-sm text-on-surface-variant block mb-1">{t("drawDateLabel")}</label>
              <input
                type="date"
                value={editFields.drawDate}
                onChange={(e) => setEditFields({ ...editFields, drawDate: e.target.value })}
                className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
              />
            </div>
            <div>
              <label className="font-label-sm text-label-sm text-on-surface-variant block mb-1">{t("dailyDeadlineLabel")}</label>
              <input
                value={editFields.limitTime}
                onChange={(e) => setEditFields({ ...editFields, limitTime: e.target.value })}
                className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
              />
            </div>
            {editError && <p className="font-label-sm text-label-sm text-error">{editError}</p>}
            <button
              onClick={saveEdit}
              disabled={savingEdit}
              className="w-full bg-primary text-on-primary font-label-md text-label-md py-3 rounded-lg hover:opacity-90 active:scale-95 transition-all disabled:opacity-60"
            >
              {savingEdit ? t("savingEllipsis") : t("saveChanges")}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
