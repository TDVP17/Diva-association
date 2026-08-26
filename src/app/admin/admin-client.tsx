"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { translate, type Lang } from "@/lib/i18n/translations";
import { getCycleDateForRound } from "@/lib/tontine-engine";
import type { TontineType } from "@/generated/prisma/enums";

interface MembershipRequest {
  id: string;
  joinedAt: string;
  user: { id: string; name: string; avatar: string | null };
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
  avatar: string | null;
  hasPhone: boolean;
  officialPosition: number | null;
  ballDrawn: number | null;
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
  rules: string | null;
  limitTime: string;
  startDate: string;
  drawDate: string | null;
  maxSlots: number | null;
  isPaused: boolean;
  lockedAt: string | null;
  registeredSlots: number;
  slots: AdminSlot[];
}

interface SwapRequestRow {
  id: string;
  requesterName: string;
  targetName: string;
  tontineSessionId: string;
  tontineType: string;
  requesterPosition: number | null;
  targetPosition: number | null;
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

const TONTINE_LABELS: Record<string, string> = {
  HEBDO_SUNDAY: "Weekly Tontine",
  MONTHLY_28: "Monthly Tontine (28th)",
  MONTHLY_25: "Monthly Tontine (25th)",
};

export function AdminClient({ lang }: { lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const [membershipQueue, setMembershipQueue] = useState<MembershipRequest[]>([]);
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [order, setOrder] = useState<AdminSlot[]>([]);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [swapRequests, setSwapRequests] = useState<SwapRequestRow[]>([]);
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
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailResult, setEmailResult] = useState<string | null>(null);

  const [showEditModal, setShowEditModal] = useState(false);
  const [editFields, setEditFields] = useState<{
    title: string;
    description: string;
    amount: string;
    fee: string;
    fineAmountPerPeriod: string;
    fineIntervalHours: string;
    rules: string;
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

  const refreshSessions = useCallback(async (keepSelected?: string) => {
    const body = await fetch("/api/admin/sessions").then((r) => r.json());
    const list: AdminSession[] = body.sessions ?? [];
    setSessions(list);
    const target =
      list.find((s) => s.id === keepSelected) ??
      list.find((s) => s.status === "DRAWING" || s.status === "ACTIVE") ??
      list[0];
    if (target) {
      setSelectedSessionId(target.id);
      setOrder(target.slots);
    }
  }, []);

  // Initial load. Inlined (rather than calling the refresh*/setSessions
  // helpers above) so each fetch's setState lives directly in a `.then`.
  useEffect(() => {
    fetch("/api/admin/membership-queue")
      .then((r) => r.json())
      .then((b) => setMembershipQueue(b.memberships ?? []));
    fetch("/api/admin/swap-requests")
      .then((r) => r.json())
      .then((b) => setSwapRequests(b.requests ?? []));
    fetch("/api/admin/sessions")
      .then((r) => r.json())
      .then((body) => {
        const list: AdminSession[] = body.sessions ?? [];
        setSessions(list);
        const target = list.find((s) => s.status === "DRAWING" || s.status === "ACTIVE") ?? list[0];
        if (target) {
          setSelectedSessionId(target.id);
          setOrder(target.slots);
        }
      });
  }, []);

  useEffect(() => {
    if (!selectedSessionId) return;
    fetch(`/api/admin/sessions/${selectedSessionId}/ledger`)
      .then((r) => r.json())
      .then(setLedger);
    fetch(`/api/admin/sessions/${selectedSessionId}/payout-claims`)
      .then((r) => r.json())
      .then((b) => setPayoutClaims(b.claims ?? []));
  }, [selectedSessionId]);

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

  // Reset the draggable order whenever the selected session changes,
  // without a setState-in-effect round trip (React's documented pattern for
  // adjusting state when a prop/derived value changes).
  const [orderForSessionId, setOrderForSessionId] = useState<string | null>(null);
  if (selectedSessionId && selectedSessionId !== orderForSessionId) {
    setOrderForSessionId(selectedSessionId);
    const s = sessions.find((s) => s.id === selectedSessionId);
    if (s) setOrder(s.slots);
  }

  async function decideMembership(request: MembershipRequest, action: "approve" | "reject") {
    setMembershipQueue((q) => q.filter((m) => m.id !== request.id));
    const res = await fetch(`/api/admin/membership/${request.id}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (!res.ok) {
      setMembershipQueue((q) => [...q, request]);
      window.alert(t("couldNotUpdateMembership"));
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
    if (!selectedSessionId) return;
    setPublishing(true);
    try {
      const res = await fetch(`/api/admin/sessions/${selectedSessionId}/publish-ranking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: order.map((m) => m.id) }),
      });
      if (res.ok) await refreshSessions(selectedSessionId);
    } finally {
      setPublishing(false);
    }
  }

  async function startDrawingPhase() {
    if (!selectedSessionId) return;
    setStartingDraw(true);
    try {
      const res = await fetch(`/api/admin/sessions/${selectedSessionId}/start-drawing`, {
        method: "POST",
      });
      if (res.ok) await refreshSessions(selectedSessionId);
    } finally {
      setStartingDraw(false);
    }
  }

  async function recordManualContribution() {
    if (!selectedSessionId || !contributionSlotId) return;
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
        setContributionResult(body.error ?? t("couldNotRecordContribution"));
        return;
      }
      setContributionResult(t("contributionRecorded"));
      setContributionSlotId("");
      fetch(`/api/admin/sessions/${selectedSessionId}/ledger`).then((r) => r.json()).then(setLedger);
    } finally {
      setRecordingContribution(false);
    }
  }

  async function decideSwap(id: string, action: "approve" | "reject") {
    setSwapRequests((rows) => rows.filter((r) => r.id !== id));
    await fetch(`/api/admin/swap-requests/${id}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    await refreshSessions(selectedSessionId ?? undefined);
  }

  async function refreshPayoutClaims() {
    if (!selectedSessionId) return;
    const body = await fetch(`/api/admin/sessions/${selectedSessionId}/payout-claims`).then((r) => r.json());
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
        setPayoutResult(body.error ?? t("failedToReleasePayout"));
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
        setPayoutResult(body.error ?? t("failedToReleasePayout"));
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
      fetch(`/api/admin/sessions/${selectedSessionId}/ledger`).then((r) => r.json()).then(setLedger);
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
    const nextNamed = Math.floor(next);
    setAddNames((current) => {
      const copy = current.slice(0, nextNamed);
      while (copy.length < nextNamed) copy.push("");
      return copy;
    });
  }

  async function addMemberManually() {
    if (!selectedSessionId || !selectedUser || addNames.some((n) => !n.trim())) return;
    setAddingMember(true);
    setAddMemberResult(null);
    try {
      const res = await fetch("/api/admin/memberships/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: selectedUser.id,
          tontineSessionId: selectedSessionId,
          slotCount: addSlotCount,
          beneficiaryNames: addNames.map((n) => n.trim()),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setAddMemberResult(body.error ?? t("couldNotAddMember"));
        return;
      }
      setAddMemberResult(t("memberAddedSuccessfully"));
      setSelectedUser(null);
      setUserQuery("");
      setAddSlotCount(1);
      setAddNames([""]);
      await refreshSessions(selectedSessionId);
    } finally {
      setAddingMember(false);
    }
  }

  async function sendMassEmail() {
    if (!selectedSessionId || !emailSubject.trim() || !emailBody.trim()) return;
    setSendingEmail(true);
    setEmailResult(null);
    try {
      const res = await fetch(`/api/admin/sessions/${selectedSessionId}/broadcast-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: emailSubject.trim(), body: emailBody.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setEmailResult(body.error ?? t("couldNotAddMember"));
        return;
      }
      setEmailResult(t("emailSentSummary", { count: String(body.sent) }));
      setEmailSubject("");
      setEmailBody("");
    } finally {
      setSendingEmail(false);
    }
  }

  function openEditModal() {
    if (!selectedSession) return;
    setEditFields({
      title: selectedSession.title ?? "",
      description: selectedSession.description ?? "",
      amount: String(selectedSession.amount),
      fee: String(selectedSession.fee),
      fineAmountPerPeriod: String(selectedSession.fineAmountPerPeriod ?? ""),
      fineIntervalHours: String(selectedSession.fineIntervalHours ?? ""),
      rules: selectedSession.rules ?? "",
      startDate: selectedSession.startDate.slice(0, 10),
      drawDate: selectedSession.drawDate ? selectedSession.drawDate.slice(0, 10) : "",
      limitTime: selectedSession.limitTime,
      maxSlots: selectedSession.maxSlots !== null ? String(selectedSession.maxSlots) : "",
    });
    setEditError(null);
    setShowEditModal(true);
  }

  async function saveEdit() {
    if (!selectedSessionId || !editFields) return;
    setSavingEdit(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/admin/sessions/${selectedSessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editFields.title,
          description: editFields.description || undefined,
          amount: Number(editFields.amount),
          fee: Number(editFields.fee),
          fineAmountPerPeriod: Number(editFields.fineAmountPerPeriod),
          fineIntervalHours: Number(editFields.fineIntervalHours),
          rules: editFields.rules || undefined,
          startDate: editFields.startDate,
          drawDate: editFields.drawDate,
          limitTime: editFields.limitTime,
          maxSlots: editFields.maxSlots ? Number(editFields.maxSlots) : null,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setEditError(body.error ?? t("couldNotUpdateCotisation"));
        return;
      }
      setShowEditModal(false);
      await refreshSessions(selectedSessionId);
    } finally {
      setSavingEdit(false);
    }
  }

  async function togglePause() {
    if (!selectedSessionId || !selectedSession) return;
    setPausing(true);
    try {
      const res = await fetch(`/api/admin/sessions/${selectedSessionId}/pause`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: !selectedSession.isPaused }),
      });
      if (res.ok) await refreshSessions(selectedSessionId);
    } finally {
      setPausing(false);
    }
  }

  async function lockSession() {
    if (!selectedSessionId) return;
    if (!window.confirm(t("lockConfirmMessage"))) return;
    setLocking(true);
    try {
      const res = await fetch(`/api/admin/sessions/${selectedSessionId}/lock`, { method: "POST" });
      if (res.ok) await refreshSessions(selectedSessionId);
      else window.alert(t("couldNotLockCotisation"));
    } finally {
      setLocking(false);
    }
  }

  async function deleteSession() {
    if (!selectedSessionId) return;
    if (!window.confirm(t("deleteConfirmMessage"))) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/admin/sessions/${selectedSessionId}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDeleteError(body.error ?? t("couldNotDeleteCotisation"));
        return;
      }
      await refreshSessions();
    } finally {
      setDeleting(false);
    }
  }

  const selectedSession = sessions.find((s) => s.id === selectedSessionId) ?? null;
  const drawUnlocked = selectedSession?.drawDate ? new Date() >= new Date(selectedSession.drawDate) : false;
  const drawUnlocksAtLabel =
    selectedSession?.drawDate
      ? new Date(selectedSession.drawDate).toLocaleString("en-US", {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";

  return (
    <main className="px-container-padding pt-stack-gap-lg pb-32 max-w-4xl mx-auto w-full flex flex-col gap-section-margin">
      <div>
        <div className="inline-flex items-center gap-2 bg-secondary-fixed-dim/20 text-on-secondary-fixed-variant px-3 py-1 rounded-full font-label-sm text-label-sm mb-2">
          <span className="material-symbols-outlined text-[16px]">shield</span>
          {t("adminControlCenter")}
        </div>
        <h2 className="font-display-lg text-display-lg text-primary">{t("adminDashboard")}</h2>
        <p className="text-on-surface-variant font-body-lg mt-2">
          {t("adminDashboardSubtitle")}
        </p>
      </div>

      {/* Pending tontine-membership requests */}
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
          <p className="font-label-sm text-label-sm text-on-surface-variant">
            {t("noPendingRequests")}
          </p>
        ) : (
          <div className="flex flex-col gap-0 border border-outline-variant/30 rounded-lg overflow-hidden">
            {membershipQueue.map((m) => (
              <div
                key={m.id}
                className="flex flex-col gap-2 p-3 bg-surface-container-lowest border-b last:border-b-0 border-outline-variant/30"
              >
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-tertiary-container text-on-tertiary flex items-center justify-center font-label-md text-label-md overflow-hidden flex-shrink-0">
                      {m.user.avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.user.avatar} alt={m.user.name} className="w-full h-full object-cover" />
                      ) : (
                        m.user.name.slice(0, 2).toUpperCase()
                      )}
                    </div>
                    <p className="font-label-md text-label-md text-on-surface truncate">
                      {t("wantsToJoin", {
                        name: m.user.name,
                        session:
                          m.tontineSession.title || TONTINE_LABELS[m.tontineSession.type] || m.tontineSession.type,
                      })}
                    </p>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => decideMembership(m, "reject")}
                      className="px-2 py-1 rounded border border-outline-variant text-on-surface-variant font-label-sm text-label-sm hover:bg-surface"
                    >
                      {t("reject")}
                    </button>
                    <button
                      onClick={() => decideMembership(m, "approve")}
                      className="px-2 py-1 rounded bg-primary text-on-primary font-label-sm text-label-sm hover:opacity-90"
                    >
                      {t("approve")}
                    </button>
                  </div>
                </div>
                {m.kycVerification && (
                  <div className="flex items-center gap-3 pl-12 flex-wrap">
                    <span className="font-label-sm text-label-sm text-on-surface-variant">
                      {m.kycVerification.documentType === "CNI" ? t("cameroonianCni") : t("passport")}
                    </span>
                    {m.kycVerification.matchConfidence !== null && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#d1fae5] text-[#065f46] font-label-sm text-label-sm">
                        <span className="material-symbols-outlined text-[14px]">verified_user</span>
                        {t("faceMatch", { percent: m.kycVerification.matchConfidence.toFixed(0) })}
                      </span>
                    )}
                    {m.kycVerification.documentImageUrl && (
                      <a
                        href={m.kycVerification.documentImageUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-label-sm text-label-sm text-primary underline"
                      >
                        {t("viewDocument")}
                      </a>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Session picker */}
      <div className="flex items-center gap-3 flex-wrap">
        {sessions.length > 0 && (
          <>
            <label className="font-label-sm text-label-sm text-on-surface-variant">{t("sessionLabel")}</label>
            <select
              value={selectedSessionId ?? ""}
              onChange={(e) => setSelectedSessionId(e.target.value)}
              className="border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md bg-white"
            >
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title || TONTINE_LABELS[s.type] || s.type} — {s.status}
                  {s.isPaused ? ` — ${t("pausedBadge")}` : ""}
                  {s.lockedAt ? ` — ${t("lockedBadge")}` : ""}
                  {s.maxSlots
                    ? ` (${s.registeredSlots}/${s.maxSlots} ${t("slots")})`
                    : ` (${s.registeredSlots} ${t("slots")})`}
                </option>
              ))}
            </select>
            {selectedSession?.status === "DRAFT" && (
              <button
                onClick={startDrawingPhase}
                disabled={startingDraw || !drawUnlocked}
                title={drawUnlocked ? undefined : t("drawUnlocksAt", { date: drawUnlocksAtLabel })}
                className="px-3 py-2 rounded-lg bg-primary text-on-primary font-label-sm text-label-sm hover:opacity-90 disabled:opacity-60"
              >
                {startingDraw
                  ? t("startingEllipsis")
                  : drawUnlocked
                    ? t("startDrawingPhase")
                    : t("drawUnlocksAt", { date: drawUnlocksAtLabel })}
              </button>
            )}
            {selectedSession && (
              <>
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
                  <span className="material-symbols-outlined text-[16px]">
                    {selectedSession.isPaused ? "play_arrow" : "pause"}
                  </span>
                  {selectedSession.isPaused ? t("resume") : t("pause")}
                </button>
                {!selectedSession.lockedAt && (
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
              </>
            )}
          </>
        )}
        <Link
          href="/admin/sessions/new"
          className="px-3 py-2 rounded-lg bg-primary text-on-primary font-label-sm text-label-sm hover:opacity-90 flex items-center gap-1 ml-auto"
        >
          <span className="material-symbols-outlined text-[16px]">add</span>
          {t("newCotisation")}
        </Link>
      </div>
      {deleteError && <p className="font-label-sm text-label-sm text-error -mt-2">{deleteError}</p>}

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
              <label className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
                {t("descriptionLabel")}
              </label>
              <textarea
                rows={2}
                value={editFields.description}
                onChange={(e) => setEditFields({ ...editFields, description: e.target.value })}
                className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
                  {t("amountPerSlot")}
                </label>
                <input
                  type="number"
                  min="1"
                  value={editFields.amount}
                  onChange={(e) => setEditFields({ ...editFields, amount: e.target.value })}
                  className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
                />
              </div>
              <div>
                <label className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
                  {t("feePerSlot")}
                </label>
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
                <label className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
                  {t("fineAmountLabel")}
                </label>
                <input
                  type="number"
                  min="0"
                  value={editFields.fineAmountPerPeriod}
                  onChange={(e) => setEditFields({ ...editFields, fineAmountPerPeriod: e.target.value })}
                  className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
                />
              </div>
              <div>
                <label className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
                  {t("fineIntervalLabel")}
                </label>
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
              <label className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
                {t("maxSlotCapacity")}
              </label>
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
              <label className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
                {t("startDate")}
              </label>
              <input
                type="date"
                value={editFields.startDate}
                onChange={(e) => setEditFields({ ...editFields, startDate: e.target.value })}
                className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
              />
            </div>
            <div>
              <label className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
                {t("drawDateLabel")}
              </label>
              <input
                type="date"
                value={editFields.drawDate}
                onChange={(e) => setEditFields({ ...editFields, drawDate: e.target.value })}
                className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
              />
            </div>
            <div>
              <label className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
                {t("dailyDeadlineLabel")}
              </label>
              <input
                value={editFields.limitTime}
                onChange={(e) => setEditFields({ ...editFields, limitTime: e.target.value })}
                className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
              />
            </div>
            <div>
              <label className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
                {t("rulesOptional")}
              </label>
              <textarea
                rows={3}
                value={editFields.rules}
                onChange={(e) => setEditFields({ ...editFields, rules: e.target.value })}
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-stack-gap-lg">
        {/* Ranking editor */}
        <section className="bg-surface rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] p-4 flex flex-col h-full">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-title-md text-title-md text-primary flex items-center gap-2">
              <span className="material-symbols-outlined">format_list_numbered</span>
              {t("payoutOrder")}
            </h3>
          </div>
          <p className="font-label-sm text-label-sm text-on-surface-variant mb-4">
            {t("dragToReorder")}
          </p>
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
                    {selectedSession &&
                      ` — ~${getCycleDateForRound(
                        selectedSession.type as TontineType,
                        new Date(selectedSession.startDate),
                        index + 1,
                      ).toLocaleDateString("en-US", { day: "numeric", month: "short" })}`}
                  </p>
                  {!m.hasPhone && (
                    <p className="font-label-sm text-label-sm text-error">{t("noWhatsappOnFile")}</p>
                  )}
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
            {publishing
              ? t("publishingEllipsis")
              : drawUnlocked
                ? t("publishOfficialRanking")
                : t("drawUnlocksAt", { date: drawUnlocksAtLabel })}
          </button>
        </section>

        <div className="flex flex-col gap-stack-gap-lg">
          {/* Ledger */}
          <section className="bg-primary text-on-primary rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] p-4 relative overflow-hidden">
            <h3 className="font-title-md text-title-md flex items-center gap-2 mb-4 relative z-10">
              <span className="material-symbols-outlined">account_balance</span>
              {t("financialLedger")}
            </h3>
            <div className="mb-4 relative z-10">
              <p className="font-label-sm text-label-sm text-primary-fixed-dim">{t("totalCollectedFees")}</p>
              <p className="font-numeric-data text-numeric-data text-white">
                {(ledger?.totalFees ?? 0).toLocaleString("en-US")} F
              </p>
            </div>
            {ledger?.feeSplit && (
              <div className="bg-on-primary-fixed-variant/50 rounded-lg p-3 mb-4 backdrop-blur-sm relative z-10">
                <div className="flex justify-between items-center border-b border-primary-fixed-dim/20 pb-2 mb-2">
                  <span className="font-label-sm text-label-sm text-primary-fixed-dim">{t("presidentLabel")}</span>
                  <span className="font-label-md text-label-md text-white">
                    {ledger.feeSplit.president.toLocaleString("en-US")} F
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-label-sm text-label-sm text-primary-fixed-dim">{t("winnerLabel")}</span>
                  <span className="font-label-md text-label-md text-white">
                    {ledger.feeSplit.winner.toLocaleString("en-US")} F
                  </span>
                </div>
              </div>
            )}
            <div className="flex justify-between items-center bg-surface-container-lowest text-on-surface rounded-lg p-3 relative z-10 shadow-sm">
              <div className="flex items-center gap-2 text-error">
                <span className="material-symbols-outlined text-[20px]">warning</span>
                <span className="font-label-md text-label-md font-bold">{t("unpaidFines")}</span>
              </div>
              <span className="font-numeric-data text-[18px] text-on-surface">
                {(ledger?.totalUnpaidFines ?? 0).toLocaleString("en-US")} F
              </span>
            </div>
          </section>

          {/* Swap requests */}
          <section className="bg-surface rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] p-4 flex-grow flex flex-col">
            <h3 className="font-title-md text-title-md text-primary flex items-center gap-2 mb-4">
              <span className="material-symbols-outlined">swap_horiz</span>
              {t("swapRequests")}
            </h3>
            {swapRequests.length === 0 ? (
              <p className="font-label-sm text-label-sm text-on-surface-variant">{t("noPendingSwaps")}</p>
            ) : (
              <div className="flex flex-col gap-0 border border-outline-variant/30 rounded-lg overflow-hidden">
                {swapRequests.map((r) => (
                  <div
                    key={r.id}
                    className="flex justify-between items-center p-3 bg-surface-container-lowest border-b last:border-b-0 border-outline-variant/30"
                  >
                    <div>
                      <p className="font-label-md text-label-md text-on-surface">
                        {t("positionAbbrev")} {r.requesterPosition ?? "?"}{" "}
                        <span className="material-symbols-outlined text-[14px] align-middle px-1">
                          arrow_forward
                        </span>{" "}
                        {t("positionAbbrev")} {r.targetPosition ?? "?"}
                      </p>
                      <p className="font-label-sm text-label-sm text-on-surface-variant">
                        {t("userAsksUser", { requester: r.requesterName, target: r.targetName })}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => decideSwap(r.id, "reject")}
                        className="px-2 py-1 rounded border border-outline-variant text-on-surface-variant font-label-sm text-label-sm hover:bg-surface"
                      >
                        {t("reject")}
                      </button>
                      <button
                        onClick={() => decideSwap(r.id, "approve")}
                        className="px-2 py-1 rounded bg-primary text-on-primary font-label-sm text-label-sm hover:opacity-90"
                      >
                        {t("approve")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Payout requests */}
          {selectedSession && (
            <section className="bg-surface rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] p-4">
              <h3 className="font-title-md text-title-md text-primary flex items-center gap-2 mb-4">
                <span className="material-symbols-outlined">payments</span>
                {t("payoutRequests")}
              </h3>

              {payoutClaims.length === 0 ? (
                <p className="font-label-sm text-label-sm text-on-surface-variant">{t("noPayoutRequests")}</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {payoutClaims.map((c) => (
                    <div key={c.id} className="bg-surface-container-lowest rounded-lg p-3 flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <div className="min-w-0">
                          <p className="font-label-md text-label-md text-on-surface truncate">
                            {c.beneficiaryName} ({c.memberName})
                          </p>
                          <p className="font-label-sm text-label-sm text-on-surface-variant truncate">
                            {c.payoutAccountName} — {c.payoutPhone}
                          </p>
                        </div>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md font-label-sm text-label-sm flex-shrink-0 ml-2 ${
                            c.status === "CONFIRMED"
                              ? "bg-[#d1fae5] text-[#065f46]"
                              : "bg-secondary-container/40 text-on-secondary-container"
                          }`}
                        >
                          {c.status}
                        </span>
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
                            <span className="font-label-sm text-label-sm text-on-surface-variant">
                              {t("beneficiaryOnFileLabel")}
                            </span>
                            <span className="font-label-md text-label-md text-on-surface">
                              {payoutPreview.beneficiaryName} ({payoutPreview.memberName})
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="font-label-sm text-label-sm text-on-surface-variant">
                              {t("amountToSendLabel")}
                            </span>
                            <span className="font-numeric-data text-numeric-data text-primary">
                              {payoutPreview.netPayout.toLocaleString("en-US")} F
                            </span>
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
                  ))}
                </div>
              )}

              {payoutResult && (
                <p className="font-label-sm text-label-sm text-on-surface-variant mt-3">{payoutResult}</p>
              )}
            </section>
          )}

          {/* Manual contribution */}
          {selectedSession && (
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
                  {selectedSession.slots.map((s) => (
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
              {contributionResult && (
                <p className="font-label-sm text-label-sm text-on-surface-variant">{contributionResult}</p>
              )}
            </section>
          )}

          {/* Add member manually */}
          {selectedSession && (
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
                    <button
                      onClick={() => setSelectedUser(null)}
                      className="text-outline hover:text-error"
                      aria-label={t("cancel")}
                    >
                      <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                  </div>
                  <select
                    value={addSlotCount}
                    onChange={(e) => handleAddSlotCountChange(Number(e.target.value))}
                    className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md bg-white"
                  >
                    {[1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((opt) => (
                      <option key={opt} value={opt}>
                        {opt} {opt !== 1 ? t("slots") : t("slot")}
                      </option>
                    ))}
                  </select>
                  {addNames.map((name, i) => (
                    <input
                      key={i}
                      value={name}
                      onChange={(e) =>
                        setAddNames((current) => current.map((n, idx) => (idx === i ? e.target.value : n)))
                      }
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
              {addMemberResult && (
                <p className="font-label-sm text-label-sm text-on-surface-variant">{addMemberResult}</p>
              )}
            </section>
          )}

          {/* Mass email */}
          {selectedSession && (
            <section className="bg-surface rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] p-4">
              <h3 className="font-title-md text-title-md text-primary flex items-center gap-2 mb-4">
                <span className="material-symbols-outlined">mail</span>
                {t("massEmailTitle")}
              </h3>
              <div className="flex flex-col gap-2 mb-3">
                <input
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  placeholder={t("emailSubjectLabel")}
                  className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md bg-white"
                />
                <textarea
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  placeholder={t("emailBodyLabel")}
                  rows={4}
                  className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md bg-white"
                />
                <button
                  onClick={sendMassEmail}
                  disabled={sendingEmail || !emailSubject.trim() || !emailBody.trim()}
                  className="bg-primary text-on-primary font-label-md text-label-md px-4 py-2.5 rounded-lg hover:opacity-90 disabled:opacity-50"
                >
                  {sendingEmail ? t("recordingEllipsis") : t("sendToAllMembers")}
                </button>
              </div>
              {emailResult && <p className="font-label-sm text-label-sm text-on-surface-variant">{emailResult}</p>}
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
