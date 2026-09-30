"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { translate, type Lang } from "@/lib/i18n/translations";
import { getCycleDateForRound } from "@/lib/tontine-engine";
import type { TontineType } from "@/generated/prisma/enums";
import { NotificationsTab } from "./notifications-tab";
import { ActivityTab } from "./activity-tab";
import { LoadingSpinner } from "@/components/loading-spinner";
import { MemberArchivesToggle } from "@/components/admin/member-archives-toggle";
import { formatXAF } from "@/lib/format-currency";
import { sessionStatusKey } from "@/lib/session-status-label";
import { CONTRIBUTION_STATUS_KEY } from "@/lib/contribution-status-label";
import { FINE_STATUS_KEY } from "@/lib/fine-status-label";
import { PAYOUT_CLAIM_STATUS_KEY } from "@/lib/payout-claim-status-label";
import { TONTINE_TYPE_LABELS } from "@/lib/tontine-labels";
import { detectMobileMoneyProvider } from "@/lib/mobile-money-provider";

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
  validatedMembersCount?: number;
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
  membershipSlotId?: string;
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
  const [directPayoutSlotId, setDirectPayoutSlotId] = useState<string>("");
  const [directPayoutName, setDirectPayoutName] = useState<string>("");
  const [directPayoutPhone, setDirectPayoutPhone] = useState<string>("");
  const [directPayoutAmount, setDirectPayoutAmount] = useState<string>("");
  const [directPayoutLoading, setDirectPayoutLoading] = useState(false);
  const [directPayoutResult, setDirectPayoutResult] = useState<string | null>(null);
  const [directPayoutError, setDirectPayoutError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  function handleCopy(text: string, key: string, e?: React.MouseEvent) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey((cur) => (cur === key ? null : cur));
    }, 2000);
  }

  function handleFillIntoDirectPayout(c: PayoutClaim) {
    setActiveTab("foodTurn");
    if (c.membershipSlotId) {
      setDirectPayoutSlotId(c.membershipSlotId);
    } else {
      const found = session?.slots.find((s) => s.beneficiaryName === c.beneficiaryName || s.name === c.memberName);
      if (found) setDirectPayoutSlotId(found.id);
    }
    setDirectPayoutName(c.payoutAccountName || c.beneficiaryName);
    const cleanDigits = (c.payoutPhone || "").replace(/\D/g, "").replace(/^237/, "");
    setDirectPayoutPhone(cleanDigits);
    if (c.netPayout) {
      setDirectPayoutAmount(String(c.netPayout));
    } else {
      const pot = (session?.amount ?? 0) * (session?.slots.length ?? 1);
      setDirectPayoutAmount(String(pot));
    }
    setDirectPayoutError(null);
    setDirectPayoutResult(null);

    setTimeout(() => {
      const formEl = document.getElementById("direct-payout-form-container");
      if (formEl) {
        formEl.scrollIntoView({ behavior: "smooth", block: "center" });
        formEl.classList.add("ring-4", "ring-emerald-500/40");
        setTimeout(() => formEl.classList.remove("ring-4", "ring-emerald-500/40"), 2500);
      }
    }, 100);
  }
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
    status: string;
    validatedMembersCount: string;
  } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [pausing, setPausing] = useState(false);
  const [locking, setLocking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [showRelaunchModal, setShowRelaunchModal] = useState(false);
  const [relaunchFields, setRelaunchFields] = useState<{
    startDate: string;
    drawDate: string;
    amount: string;
    fee: string;
    maxSlots: string;
  }>({
    startDate: "",
    drawDate: "",
    amount: "",
    fee: "",
    maxSlots: "",
  });
  const [relaunching, setRelaunching] = useState(false);
  const [relaunchError, setRelaunchError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

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

    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get("tab");
      if (tabParam && TABS.includes(tabParam as Tab)) {
        setActiveTab(tabParam as Tab);
      }
      const fillSlot = params.get("fillSlot");
      const fillName = params.get("fillName");
      const fillPhone = params.get("fillPhone");
      if (fillSlot) setDirectPayoutSlotId(fillSlot);
      if (fillName) setDirectPayoutName(fillName);
      if (fillPhone) setDirectPayoutPhone(fillPhone);
      if (fillSlot || fillName || fillPhone) {
        setActiveTab("foodTurn");
        setTimeout(() => {
          const formEl = document.getElementById("direct-payout-form-container");
          if (formEl) {
            formEl.scrollIntoView({ behavior: "smooth", block: "center" });
            formEl.classList.add("ring-4", "ring-emerald-500/40");
            setTimeout(() => formEl.classList.remove("ring-4", "ring-emerald-500/40"), 2500);
          }
        }, 400);
      }
    }
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

  async function decideMembership(request: MembershipRequest, action: "approve" | "reject" | "ban") {
    let reason: string | null = null;
    if (action === "reject") {
      reason = window.prompt(t("rejectionReasonLabel"), "");
      if (reason === null) return;
    } else if (action === "ban") {
      const confirmMsg =
        lang === "fr"
          ? `Voulez-vous vraiment bannir ${request.user.name} de cette cotisation ? Ce membre ne pourra plus faire de demande.`
          : `Are you sure you want to ban ${request.user.name} from this cotisation? They will not be able to re-apply.`;
      if (!window.confirm(confirmMsg)) return;
      reason = window.prompt(lang === "fr" ? "Motif du bannissement (optionnel) :" : "Ban reason (optional):", "") || null;
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
          pot: formatXAF(body.pot),
          deducted: formatXAF(body.deducted),
          net: formatXAF(body.netPayout),
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

  function handleSelectDirectPayoutSlot(slotId: string) {
    setDirectPayoutSlotId(slotId);
    setDirectPayoutResult(null);
    setDirectPayoutError(null);
    const foundSlot = session?.slots.find((s) => s.id === slotId);
    if (foundSlot) {
      setDirectPayoutName(foundSlot.beneficiaryName || foundSlot.name);
      const pot = (session?.amount ?? 0) * (session?.slots.length ?? 1);
      setDirectPayoutAmount(String(pot));
    } else {
      setDirectPayoutName("");
      setDirectPayoutAmount("");
    }
  }

  async function executeDirectPayout(e: React.FormEvent) {
    e.preventDefault();
    if (!directPayoutSlotId || !directPayoutName.trim() || !directPayoutPhone.trim()) {
      return;
    }
    setDirectPayoutLoading(true);
    setDirectPayoutError(null);
    setDirectPayoutResult(null);
    try {
      const res = await fetch("/api/admin/payouts/direct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tontineSessionId,
          membershipSlotId: directPayoutSlotId,
          payoutAccountName: directPayoutName.trim(),
          payoutPhone: directPayoutPhone.trim(),
          customAmount: directPayoutAmount ? Number(directPayoutAmount) : undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setDirectPayoutError(data?.error || t("failedToReleasePayout"));
      } else {
        setDirectPayoutResult(
          `${t("payoutSentSuccess")} (${formatXAF(data.netPayout)})`
        );
        await refreshPayoutClaims();
      }
    } catch {
      setDirectPayoutError(t("failedToReleasePayout"));
    } finally {
      setDirectPayoutLoading(false);
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
      status: session.status,
      validatedMembersCount: String(session.validatedMembersCount ?? 0),
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
          status: editFields.status,
          validatedMembersCount: editFields.status === "ACTIVE" ? Number(editFields.validatedMembersCount || 0) : 0,
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

  function openRelaunchModal() {
    if (!session) return;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);
    setRelaunchFields({
      startDate: tomorrowStr,
      drawDate: tomorrowStr,
      amount: String(session.amount),
      fee: String(session.fee),
      maxSlots: session.maxSlots !== null ? String(session.maxSlots) : "",
    });
    setRelaunchError(null);
    setShowRelaunchModal(true);
  }

  async function executeRelaunch() {
    if (!relaunchFields.startDate) {
      setRelaunchError(t("couldNotRelaunchCotisation"));
      return;
    }
    setRelaunching(true);
    setRelaunchError(null);
    try {
      const res = await fetch(`/api/admin/sessions/${tontineSessionId}/relaunch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: relaunchFields.startDate,
          drawDate: relaunchFields.drawDate ? relaunchFields.drawDate : null,
          amount: relaunchFields.amount ? Number(relaunchFields.amount) : undefined,
          fee: relaunchFields.fee ? Number(relaunchFields.fee) : undefined,
          maxSlots: relaunchFields.maxSlots ? Number(relaunchFields.maxSlots) : null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRelaunchError(data.error || t("couldNotRelaunchCotisation"));
        return;
      }
      setShowRelaunchModal(false);
      await refreshSession();
    } catch {
      setRelaunchError(t("couldNotRelaunchCotisation"));
    } finally {
      setRelaunching(false);
    }
  }

  async function closeSession() {
    if (!window.confirm(t("closeCotisationConfirm"))) return;
    setClosing(true);
    try {
      const res = await fetch(`/api/admin/sessions/${tontineSessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CLOSED" }),
      });
      if (!res.ok) {
        window.alert(t("couldNotCloseCotisation"));
        return;
      }
      await refreshSession();
    } finally {
      setClosing(false);
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
        setDeleteError(body?.error || t("couldNotDeleteCotisation"));
        return;
      }
      router.refresh();
      router.push("/admin/contributions");
    } catch {
      setDeleteError(t("couldNotDeleteCotisation"));
    } finally {
      setDeleting(false);
    }
  }

  if (!session) {
    return (
      <main className="px-container-padding py-stack-gap-lg max-w-4xl mx-auto">
        <LoadingSpinner fullPage />
      </main>
    );
  }

  const drawUnlocked = session.drawDate ? new Date() >= new Date(session.drawDate) : false;
  const drawUnlocksAtLabel = session.drawDate
    ? new Date(session.drawDate).toLocaleString("en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "";
  const sessionLabel = session.title || TONTINE_TYPE_LABELS[session.type as keyof typeof TONTINE_TYPE_LABELS] || session.type;

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
        <Link href="/admin/contributions" className="font-label-sm text-label-sm text-primary underline mb-2 inline-flex items-center gap-1">
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          {t("myCotisationsCard")}
        </Link>
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <h2 className="font-headline-lg-mobile text-headline-lg-mobile md:font-headline-lg md:text-headline-lg text-primary">
              {sessionLabel}
            </h2>
            {session.description && (
              <p className="font-body-md text-sm text-on-surface-variant mt-1.5 max-w-2xl bg-surface-container-low/70 p-3 rounded-lg border border-surface-variant/70 whitespace-pre-line">
                {session.description}
              </p>
            )}
            <div className="flex items-center gap-2 mt-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-secondary-container/30 text-on-secondary-container font-label-sm text-label-sm">
                {t(sessionStatusKey(session.status))}
              </span>
              {session.isPaused && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-secondary-container/40 text-on-secondary-container font-label-sm text-label-sm">
                  {t("pausedBadge")}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={deleteSession}
            disabled={deleting}
            className="px-3 py-1.5 rounded-lg border border-error/50 text-error hover:bg-error/5 text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
            title={t("delete")}
          >
            <span className="material-symbols-outlined text-[16px]">delete</span>
            {deleting ? t("savingEllipsis") : t("delete")}
          </button>
        </div>
        {deleteError && (
          <div className="p-3 rounded-lg bg-error-container/40 border border-error/30 text-error text-xs md:text-sm font-medium mt-3">
            {deleteError}
          </div>
        )}
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
            {tab === "members" && membershipQueue.length > 0 && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-error text-on-error font-label-sm text-[10px] leading-none">
                {membershipQueue.length}
              </span>
            )}
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
              {(session.status === "CLOSED" || session.status === "ACTIVE") && (
                <button
                  onClick={openRelaunchModal}
                  className="px-3 py-2 rounded-lg bg-emerald-600 text-white font-label-sm text-label-sm hover:bg-emerald-700 flex items-center gap-1 shadow-sm"
                >
                  <span className="material-symbols-outlined text-[16px]">restart_alt</span>
                  {t("relaunchCotisation")}
                </button>
              )}
              {(session.status === "ACTIVE" || session.status === "DRAWING") && (
                <button
                  onClick={closeSession}
                  disabled={closing}
                  className="px-3 py-2 rounded-lg border border-amber-600/40 text-amber-700 font-label-sm text-label-sm hover:bg-amber-50 disabled:opacity-60 flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[16px]">check_circle</span>
                  {closing ? t("closing") : t("closeCotisation")}
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
                {deleting ? t("savingEllipsis") : t("delete")}
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
              <p className="font-numeric-data text-numeric-data text-white">{formatXAF(ledger?.totalFees ?? 0)}</p>
            </div>
            {ledger?.feeSplit && (
              <div className="bg-on-primary-fixed-variant/50 rounded-lg p-3 mb-4 backdrop-blur-sm relative z-10">
                <div className="flex justify-between items-center border-b border-primary-fixed-dim/20 pb-2 mb-2">
                  <span className="font-label-sm text-label-sm text-primary-fixed-dim">{t("presidentLabel")}</span>
                  <span className="font-label-md text-label-md text-white">{formatXAF(ledger.feeSplit.president)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-label-sm text-label-sm text-primary-fixed-dim">{t("winnerLabel")}</span>
                  <span className="font-label-md text-label-md text-white">{formatXAF(ledger.feeSplit.winner)}</span>
                </div>
              </div>
            )}
            <div className="flex justify-between items-center bg-surface-container-lowest text-on-surface rounded-lg p-3 relative z-10 shadow-sm">
              <div className="flex items-center gap-2 text-error">
                <span className="material-symbols-outlined text-[20px]">warning</span>
                <span className="font-label-md text-label-md font-bold">{t("unpaidFines")}</span>
              </div>
              <span className="font-numeric-data text-[18px] text-on-surface">{formatXAF(ledger?.totalUnpaidFines ?? 0)}</span>
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
                      <Link
                        href={`/admin/support?with=${encodeURIComponent(m.user.id)}&name=${encodeURIComponent(m.user.name)}`}
                        className="font-label-md text-label-md text-on-surface hover:text-primary hover:underline truncate flex items-center gap-1.5 group"
                        title={lang === "fr" ? `Écrire à ${m.user.name}` : `Message ${m.user.name}`}
                      >
                        <span className="truncate">{m.user.name}</span>
                        <span className="material-symbols-outlined text-[15px] text-primary opacity-60 group-hover:opacity-100 flex-shrink-0">
                          chat
                        </span>
                      </Link>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <Link
                        href={`/admin/support?with=${encodeURIComponent(m.user.id)}&name=${encodeURIComponent(m.user.name)}`}
                        className="px-2 py-1 rounded border border-primary/30 text-primary hover:bg-primary/10 font-label-sm text-xs flex items-center gap-1"
                        title={lang === "fr" ? `Écrire à ${m.user.name}` : `Message ${m.user.name}`}
                      >
                        <span className="material-symbols-outlined text-[15px]">chat</span>
                        <span>{lang === "fr" ? "Écrire" : "Chat"}</span>
                      </Link>
                      <button onClick={() => decideMembership(m, "reject")} className="px-2 py-1 rounded border border-outline-variant text-on-surface-variant font-label-sm text-label-sm hover:bg-surface">
                        {t("reject")}
                      </button>
                      <button
                        onClick={() => {
                          const confirmMsg =
                            lang === "fr"
                              ? `Voulez-vous vraiment bannir ${m.user.name} ? Cette personne ne pourra plus se connecter à l'application avec son email ou son numéro de téléphone.`
                              : `Are you sure you want to ban ${m.user.name}? This user will not be able to log in to the application.`;
                          if (window.confirm(confirmMsg)) {
                            decideMembership(m, "ban");
                          }
                        }}
                        className="px-2 py-1 rounded border border-error/30 text-error bg-error-container/20 font-label-sm text-label-sm hover:bg-error-container/40"
                      >
                        {lang === "fr" ? "Bannir" : "Ban"}
                      </button>
                      {session.status === "DRAFT" ? (
                        <button onClick={() => decideMembership(m, "approve")} className="px-2 py-1 rounded bg-primary text-on-primary font-label-sm text-label-sm hover:opacity-90">
                          {t("approve")}
                        </button>
                      ) : (
                        <span className="px-2 py-1 text-xs text-on-surface-variant italic">
                          {lang === "fr" ? "Tirage déjà lancé" : "Draw started"}
                        </span>
                      )}
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
                  <div className="min-w-0 flex-1 pr-2">
                    <Link
                      href={`/admin/support?with=${encodeURIComponent(s.userId)}&name=${encodeURIComponent(s.name)}`}
                      className="font-label-md text-label-md text-on-surface hover:text-primary hover:underline font-semibold flex items-center gap-1.5 truncate group"
                      title={lang === "fr" ? `Écrire à ${s.name}` : `Message ${s.name}`}
                    >
                      <span className="truncate">{s.beneficiaryName}</span>
                      <span className="material-symbols-outlined text-[16px] text-primary opacity-60 group-hover:opacity-100 flex-shrink-0">
                        chat
                      </span>
                    </Link>
                    <Link
                      href={`/admin/support?with=${encodeURIComponent(s.userId)}&name=${encodeURIComponent(s.name)}`}
                      className="font-label-sm text-label-sm text-on-surface-variant hover:text-primary transition-colors block truncate"
                      title={lang === "fr" ? `Écrire à ${s.name}` : `Message ${s.name}`}
                    >
                      {s.name}
                      {s.memberCode && ` · ${s.memberCode}`}
                    </Link>
                    <MemberArchivesToggle userId={s.userId} lang={lang} />
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Link
                      href={`/admin/support?with=${encodeURIComponent(s.userId)}&name=${encodeURIComponent(s.name)}`}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-primary/30 text-primary hover:bg-primary/10 font-label-sm text-xs font-semibold transition-colors"
                      title={lang === "fr" ? `Envoyer un message à ${s.name}` : `Send message to ${s.name}`}
                    >
                      <span className="material-symbols-outlined text-[15px]">chat</span>
                      <span>{lang === "fr" ? "Écrire" : "Chat"}</span>
                    </Link>
                    <button
                      type="button"
                      onClick={async () => {
                        const confirmMsg =
                          lang === "fr"
                            ? `Voulez-vous vraiment bannir ${s.name} ? Cette personne sera bannie de la plateforme et ne pourra plus se connecter avec son email ou son numéro de téléphone.`
                            : `Are you sure you want to ban ${s.name}? They will be banned from the platform and unable to log in with their email or phone number.`;
                        if (!window.confirm(confirmMsg)) return;
                        try {
                          const res = await fetch(`/api/admin/users/${s.userId}/ban`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ isBanned: true, reason: `Banni depuis la cotisation ${session?.title ?? session?.id}` }),
                          });
                          if (res.ok) {
                            alert(lang === "fr" ? "Membre banni avec succès." : "Member successfully banned.");
                            window.location.reload();
                          }
                        } catch (e) {
                          console.error("Ban error:", e);
                        }
                      }}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-error/30 text-error bg-error/5 hover:bg-error/15 font-label-sm text-xs transition-colors"
                      title={lang === "fr" ? `Bannir ${s.name}` : `Ban ${s.name}`}
                    >
                      <span className="material-symbols-outlined text-[14px]">block</span>
                      <span>{lang === "fr" ? "Bannir" : "Ban"}</span>
                    </button>
                    <span
                      className={`inline-flex items-center px-2 py-1 rounded-md font-label-sm text-label-sm flex-shrink-0 ${
                        s.paidThisCycle ? "bg-[#d1fae5] text-[#065f46]" : "bg-secondary-fixed text-on-secondary-fixed-variant"
                      }`}
                    >
                      {s.paidThisCycle ? t("paidStatus") : t("unpaidStatus")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {session.status === "DRAFT" && (
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
          )}
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
                        <p className="font-numeric-data text-[14px] text-on-surface">{formatXAF(tx.amount)}</p>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md font-label-sm text-label-sm ${
                            tx.status === "PAID" ? "bg-[#d1fae5] text-[#065f46]" : "bg-secondary-fixed text-on-secondary-fixed-variant"
                          }`}
                        >
                          {t(CONTRIBUTION_STATUS_KEY[tx.status] ?? "pending")}
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
        <section className="bg-surface rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] p-4 flex flex-col gap-6">
          {/* Formulaire de virement direct Fapshi */}
          <div id="direct-payout-form-container" className="bg-surface-container-lowest border border-outline-variant/60 rounded-xl p-5 shadow-sm transition-all duration-300">
            <h4 className="font-title-md text-title-md text-primary flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">send_money</span>
              {t("directPayoutTitle")}
            </h4>
            <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
              {t("directPayoutSubtitle")}
            </p>

            <form onSubmit={executeDirectPayout} className="mt-4 flex flex-col gap-4">
              <div>
                <label className="block font-label-sm text-label-sm text-on-surface font-semibold mb-1">
                  {t("selectBeneficiarySlot")}
                </label>
                <select
                  value={directPayoutSlotId}
                  onChange={(e) => handleSelectDirectPayoutSlot(e.target.value)}
                  className="w-full bg-surface border border-outline-variant rounded-lg p-2.5 font-body-md text-body-md text-on-surface focus:outline-none focus:border-primary"
                  required
                >
                  <option value="">-- {t("selectBeneficiarySlot")} --</option>
                  {(session?.slots ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      #{s.officialPosition ?? "?"} — {s.beneficiaryName} ({s.name})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block font-label-sm text-label-sm text-on-surface font-semibold mb-1">
                    {t("payoutAccountNameInput")}
                  </label>
                  <input
                    type="text"
                    value={directPayoutName}
                    onChange={(e) => setDirectPayoutName(e.target.value)}
                    placeholder="Ex: Jean Dupont"
                    className="w-full bg-surface border border-outline-variant rounded-lg p-2.5 font-body-md text-body-md text-on-surface focus:outline-none focus:border-primary"
                    required
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-label-sm text-label-sm text-on-surface font-semibold">
                      {t("payoutPhoneInput")}
                    </label>
                    {(() => {
                      const digits = directPayoutPhone.replace(/\D/g, "").replace(/^237/, "");
                      const provider = detectMobileMoneyProvider(digits);
                      if (provider === "MTN") {
                        return (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-[#FFCC00] text-black">
                            MTN Mobile Money
                          </span>
                        );
                      }
                      if (provider === "ORANGE") {
                        return (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-[#FF6600] text-white">
                            Orange Money
                          </span>
                        );
                      }
                      return null;
                    })()}
                  </div>
                  <input
                    type="tel"
                    value={directPayoutPhone}
                    onChange={(e) => setDirectPayoutPhone(e.target.value)}
                    placeholder="Ex: 677123456 ou 699123456"
                    className="w-full bg-surface border border-outline-variant rounded-lg p-2.5 font-body-md text-body-md text-on-surface focus:outline-none focus:border-primary"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block font-label-sm text-label-sm text-on-surface font-semibold mb-1">
                  {t("payoutAmountInput")}
                </label>
                <input
                  type="number"
                  value={directPayoutAmount}
                  onChange={(e) => setDirectPayoutAmount(e.target.value)}
                  className="w-full bg-surface border border-outline-variant rounded-lg p-2.5 font-body-md text-body-md text-on-surface focus:outline-none focus:border-primary"
                  required
                />
              </div>

              {directPayoutError && (
                <div className="p-3 bg-error-container text-on-error-container rounded-lg text-sm font-medium flex items-center gap-2">
                  <span className="material-symbols-outlined text-error text-[18px]">error</span>
                  <span>{directPayoutError}</span>
                </div>
              )}

              {directPayoutResult && (
                <div className="p-3 bg-[#d1fae5] border border-[#10b981]/30 text-[#065f46] rounded-lg text-sm font-medium flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#059669] text-[18px]">check_circle</span>
                  <span>{directPayoutResult}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={directPayoutLoading || !directPayoutSlotId || !directPayoutPhone || !directPayoutName}
                className="w-full sm:w-auto self-start bg-primary text-on-primary font-label-md text-label-md px-6 py-2.5 rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2 transition-opacity"
              >
                {directPayoutLoading ? (
                  <>
                    <LoadingSpinner className="w-4 h-4 text-on-primary" />
                    <span>{t("sendingPayout")}</span>
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[18px]">payments</span>
                    <span>{t("sendFapshiPayout")}</span>
                  </>
                )}
              </button>
            </form>
          </div>

          <div>
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
                        <p className="font-label-md text-label-md text-on-surface truncate font-bold">
                          {c.beneficiaryName} ({c.memberName})
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0 ml-2">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md font-label-sm text-label-sm ${
                            c.status === "CONFIRMED" ? "bg-[#d1fae5] text-[#065f46]" : "bg-secondary-container/40 text-on-secondary-container"
                          }`}
                        >
                          {t(PAYOUT_CLAIM_STATUS_KEY[c.status])}
                        </span>
                        {c.status === "CONFIRMED" && (
                          <p className="font-label-sm text-label-sm text-on-surface-variant mt-0.5">
                            {t("outstandingZero")}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Coordonnees Fapshi avec boutons copier */}
                    <div className="rounded-lg border border-slate-200 bg-white p-3 flex flex-col gap-2.5 shadow-2xs">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2 flex-wrap text-sm">
                          <span className="text-slate-500 font-medium">{t("payoutAccountNameLabel")}:</span>
                          <span className="font-bold text-slate-900">{c.payoutAccountName}</span>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => handleCopy(c.payoutAccountName, `claim-name-${c.id}`, e)}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold transition-colors ${
                            copiedKey === `claim-name-${c.id}`
                              ? "bg-emerald-600 text-white"
                              : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                          }`}
                        >
                          <span className="material-symbols-outlined text-[14px]">
                            {copiedKey === `claim-name-${c.id}` ? "check" : "content_copy"}
                          </span>
                          {copiedKey === `claim-name-${c.id}` ? t("copied") : t("copyAccountName")}
                        </button>
                      </div>

                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2 flex-wrap text-sm">
                          <span className="text-slate-500 font-medium">{t("payoutPhoneLabel")}:</span>
                          <span className="font-bold font-numeric-data text-slate-900">{c.payoutPhone}</span>
                          {(() => {
                            const digits = (c.payoutPhone || "").replace(/\D/g, "").replace(/^237/, "");
                            const p = detectMobileMoneyProvider(digits);
                            if (p === "MTN") {
                              return (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-bold bg-[#FFCC00] text-black">
                                  MTN MoMo
                                </span>
                              );
                            }
                            if (p === "ORANGE") {
                              return (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-bold bg-[#FF6600] text-white">
                                  Orange Money
                                </span>
                              );
                            }
                            return null;
                          })()}
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            const digits = (c.payoutPhone || "").replace(/\D/g, "").replace(/^237/, "");
                            handleCopy(digits, `claim-phone-${c.id}`, e);
                          }}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold transition-colors ${
                            copiedKey === `claim-phone-${c.id}`
                              ? "bg-emerald-600 text-white"
                              : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                          }`}
                        >
                          <span className="material-symbols-outlined text-[14px]">
                            {copiedKey === `claim-phone-${c.id}` ? "check" : "content_copy"}
                          </span>
                          {copiedKey === `claim-phone-${c.id}` ? t("copied") : t("copyAccountNumber")}
                        </button>
                      </div>

                      {c.status !== "CONFIRMED" && (
                        <div className="pt-2 border-t border-slate-100 flex items-center justify-end">
                          <button
                            type="button"
                            onClick={() => handleFillIntoDirectPayout(c)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100 text-xs font-semibold transition-colors"
                          >
                            <span className="material-symbols-outlined text-[16px] text-emerald-600">input</span>
                            {t("fillInPayoutForm")}
                          </button>
                        </div>
                      )}
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
                      <div className="bg-white rounded-lg p-4 flex flex-col gap-3 border border-outline-variant shadow-sm">
                        <h4 className="font-label-md text-label-md font-bold text-on-surface">{t("payoutPreviewTitle")}</h4>
                        <div className="flex justify-between">
                          <span className="font-label-sm text-label-sm text-on-surface-variant">{t("beneficiaryOnFileLabel")}</span>
                          <span className="font-label-md text-label-md font-semibold text-on-surface">
                            {payoutPreview.beneficiaryName} ({payoutPreview.memberName})
                          </span>
                        </div>
                        <div className="flex items-center justify-between bg-slate-50 rounded-lg p-2.5 border border-slate-200">
                          <div>
                            <span className="text-xs text-slate-500 font-medium block">{t("payoutAccountNameLabel")}</span>
                            <span className="text-sm font-bold text-slate-900">{payoutPreview.payoutAccountName}</span>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => handleCopy(payoutPreview.payoutAccountName, `prev-name-${c.id}`, e)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-100"
                          >
                            <span className="material-symbols-outlined text-[13px]">
                              {copiedKey === `prev-name-${c.id}` ? "check" : "content_copy"}
                            </span>
                            {copiedKey === `prev-name-${c.id}` ? t("copied") : t("copy")}
                          </button>
                        </div>
                        <div className="flex items-center justify-between bg-slate-50 rounded-lg p-2.5 border border-slate-200">
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-slate-500 font-medium">{t("payoutPhoneLabel")}</span>
                              {(() => {
                                const digits = (payoutPreview.payoutPhone || "").replace(/\D/g, "").replace(/^237/, "");
                                const p = detectMobileMoneyProvider(digits);
                                if (p === "MTN") return <span className="px-1 py-0.2 rounded text-[10px] font-bold bg-[#FFCC00] text-black">MTN</span>;
                                if (p === "ORANGE") return <span className="px-1 py-0.2 rounded text-[10px] font-bold bg-[#FF6600] text-white">Orange</span>;
                                return null;
                              })()}
                            </div>
                            <span className="text-sm font-bold font-numeric-data text-slate-900">{payoutPreview.payoutPhone}</span>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              const digits = (payoutPreview.payoutPhone || "").replace(/\D/g, "").replace(/^237/, "");
                              handleCopy(digits, `prev-phone-${c.id}`, e);
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-100"
                          >
                            <span className="material-symbols-outlined text-[13px]">
                              {copiedKey === `prev-phone-${c.id}` ? "check" : "content_copy"}
                            </span>
                            {copiedKey === `prev-phone-${c.id}` ? t("copied") : t("copy")}
                          </button>
                        </div>
                        <div className="flex justify-between items-center pt-1 border-t border-slate-200">
                          <span className="font-label-sm text-label-sm text-on-surface-variant">{t("amountToSendLabel")}</span>
                          <span className="font-numeric-data text-lg font-bold text-primary">{formatXAF(payoutPreview.netPayout)}</span>
                        </div>
                        <p className="font-label-sm text-xs text-slate-600 bg-amber-50 border border-amber-200 rounded p-2">
                          {lang === "fr"
                            ? "Fapshi débitera votre compte administrateur et transférera les fonds directement au nom et au numéro ci-dessus."
                            : "Fapshi will debit your admin account and transfer the funds directly to the name and number above."}
                        </p>
                        <div className="flex flex-col gap-2 mt-1">
                          <button
                            onClick={confirmReleasePayout}
                            disabled={releasing}
                            className="w-full bg-primary text-on-primary font-label-md text-label-md py-2.5 rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2 shadow-xs"
                          >
                            {releasing ? (
                              <span>{t("recordingEllipsis")}</span>
                            ) : (
                              <>
                                <span className="material-symbols-outlined text-[18px]">payments</span>
                                <span>{t("confirmAndSend")}</span>
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleFillIntoDirectPayout(c)}
                            className="w-full border border-slate-300 bg-slate-50 text-slate-700 font-label-sm text-xs py-2 rounded-lg hover:bg-slate-100 flex items-center justify-center gap-1.5"
                          >
                            <span className="material-symbols-outlined text-[16px]">edit_note</span>
                            <span>{t("fillInPayoutForm")}</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {payoutResult && <p className="font-label-sm text-label-sm text-on-surface-variant mt-3">{payoutResult}</p>}
          </div>
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
                    <p className="font-numeric-data text-[14px] text-error">{formatXAF(f.amount)}</p>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-md font-label-sm text-label-sm ${
                        f.status === "UNPAID" ? "bg-error-container text-on-error-container" : "bg-[#d1fae5] text-[#065f46]"
                      }`}
                    >
                      {t(FINE_STATUS_KEY[f.status] ?? "unpaidStatus")}
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
            <div className="p-3.5 rounded-xl bg-surface-container-low border border-surface-variant flex flex-col gap-2.5">
              <div>
                <label className="font-label-sm text-label-sm text-on-surface font-semibold block mb-1">
                  {t("cotisationStatusLabel")}
                </label>
                <select
                  value={editFields.status}
                  onChange={(e) => {
                    const next = e.target.value;
                    setEditFields({
                      ...editFields,
                      status: next,
                      validatedMembersCount: next === "ACTIVE" ? editFields.validatedMembersCount : "0",
                    });
                  }}
                  className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md bg-white font-medium"
                >
                  <option value="DRAFT">{t("statusDraftOption")}</option>
                  <option value="ACTIVE">{t("statusActiveOption")}</option>
                  <option value="DRAWING">{t("sessionStatusDrawing")}</option>
                  <option value="CLOSED">{t("sessionStatusClosed")}</option>
                </select>
                <p className="font-label-sm text-xs text-on-surface-variant mt-1">
                  {editFields.status === "ACTIVE" ? t("statusActiveHelper") : t("statusDraftHelper")}
                </p>
              </div>
              {editFields.status === "ACTIVE" && (
                <div className="pt-2 border-t border-surface-variant animate-in fade-in duration-200">
                  <label className="font-label-sm text-label-sm text-on-surface font-semibold block mb-1">
                    {t("validatedMembersCountLabel")}
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={editFields.validatedMembersCount}
                    onChange={(e) => setEditFields({ ...editFields, validatedMembersCount: e.target.value })}
                    className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md bg-white font-medium"
                  />
                  <p className="font-label-sm text-xs text-on-surface-variant mt-1">
                    {t("validatedMembersCountHelper")}
                  </p>
                </div>
              )}
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
      {showRelaunchModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-xl shadow-xl max-w-lg w-full p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-title-md text-title-md text-primary flex items-center gap-2">
                <span className="material-symbols-outlined text-emerald-600">restart_alt</span>
                {t("relaunchModalTitle")}
              </h3>
              <button onClick={() => setShowRelaunchModal(false)} aria-label={t("cancel")}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs md:text-sm leading-relaxed flex items-start gap-2">
              <span className="material-symbols-outlined text-[20px] text-emerald-600 flex-shrink-0 mt-0.5">info</span>
              <div>{t("relaunchModalDescription")}</div>
            </div>

            <div>
              <label className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
                {t("newStartDate")} *
              </label>
              <input
                type="date"
                value={relaunchFields.startDate}
                onChange={(e) => setRelaunchFields({ ...relaunchFields, startDate: e.target.value })}
                className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
              />
            </div>

            <div>
              <label className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
                {t("newDrawDate")}
              </label>
              <input
                type="date"
                value={relaunchFields.drawDate}
                onChange={(e) => setRelaunchFields({ ...relaunchFields, drawDate: e.target.value })}
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
                  value={relaunchFields.amount}
                  onChange={(e) => setRelaunchFields({ ...relaunchFields, amount: e.target.value })}
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
                  value={relaunchFields.fee}
                  onChange={(e) => setRelaunchFields({ ...relaunchFields, fee: e.target.value })}
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
                min="1"
                value={relaunchFields.maxSlots}
                onChange={(e) => setRelaunchFields({ ...relaunchFields, maxSlots: e.target.value })}
                placeholder={t("leaveBlankForNoLimit")}
                className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
              />
            </div>

            {relaunchError && <p className="font-label-sm text-label-sm text-error">{relaunchError}</p>}

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowRelaunchModal(false)}
                className="flex-1 border border-outline-variant text-on-surface font-label-md text-label-md py-2.5 rounded-lg hover:bg-surface active:scale-95 transition-all"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={executeRelaunch}
                disabled={relaunching}
                className="flex-1 bg-emerald-600 text-white font-label-md text-label-md py-2.5 rounded-lg hover:bg-emerald-700 active:scale-95 transition-all disabled:opacity-60 shadow-sm flex items-center justify-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[18px]">restart_alt</span>
                {relaunching ? t("relaunching") : t("confirmRelaunch")}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
