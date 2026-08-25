"use client";

import { useCallback, useEffect, useState } from "react";

interface AccountApplicant {
  id: string;
  name: string;
  avatar: string | null;
  city: string | null;
  neighborhood: string | null;
}

interface MembershipRequest {
  id: string;
  joinedAt: string;
  user: { id: string; name: string; avatar: string | null };
  tontineSession: { id: string; type: string; status: string };
}

interface AdminMembership {
  id: string;
  userId: string;
  name: string;
  avatar: string | null;
  hasPhone: boolean;
  officialPosition: number | null;
  ballDrawn: number | null;
}

interface AdminSession {
  id: string;
  type: string;
  status: string;
  startDate: string;
  memberships: AdminMembership[];
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

const TONTINE_LABELS: Record<string, string> = {
  HEBDO_SUNDAY: "Weekly Tontine",
  MONTHLY_28: "Monthly Tontine (28th)",
  MONTHLY_25: "Monthly Tontine (25th)",
};

export function AdminClient() {
  const [accountQueue, setAccountQueue] = useState<AccountApplicant[]>([]);
  const [membershipQueue, setMembershipQueue] = useState<MembershipRequest[]>([]);
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [order, setOrder] = useState<AdminMembership[]>([]);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [swapRequests, setSwapRequests] = useState<SwapRequestRow[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [payoutUserId, setPayoutUserId] = useState<string>("");
  const [payoutResult, setPayoutResult] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

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
      setOrder(target.memberships);
    }
  }, []);

  // Initial load. Inlined (rather than calling the refresh*/setSessions
  // helpers above) so each fetch's setState lives directly in a `.then`.
  useEffect(() => {
    fetch("/api/admin/account-queue")
      .then((r) => r.json())
      .then((b) => setAccountQueue(b.users ?? []));
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
          setOrder(target.memberships);
        }
      });
  }, []);

  useEffect(() => {
    if (!selectedSessionId) return;
    fetch(`/api/admin/sessions/${selectedSessionId}/ledger`)
      .then((r) => r.json())
      .then(setLedger);
  }, [selectedSessionId]);

  // Reset the draggable order whenever the selected session changes,
  // without a setState-in-effect round trip (React's documented pattern for
  // adjusting state when a prop/derived value changes).
  const [orderForSessionId, setOrderForSessionId] = useState<string | null>(null);
  if (selectedSessionId && selectedSessionId !== orderForSessionId) {
    setOrderForSessionId(selectedSessionId);
    const s = sessions.find((s) => s.id === selectedSessionId);
    if (s) setOrder(s.memberships);
  }

  async function decideAccount(applicant: AccountApplicant, action: "approve" | "reject") {
    setAccountQueue((q) => q.filter((u) => u.id !== applicant.id));
    const res = await fetch(`/api/admin/account/${applicant.id}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (!res.ok) {
      // Put it back and let the admin know the change didn't actually save.
      setAccountQueue((q) => [...q, applicant]);
      window.alert("Could not update this account. Please try again.");
    }
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
      window.alert("Could not update this membership request. Please try again.");
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

  async function decideSwap(id: string, action: "approve" | "reject") {
    setSwapRequests((rows) => rows.filter((r) => r.id !== id));
    await fetch(`/api/admin/swap-requests/${id}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    await refreshSessions(selectedSessionId ?? undefined);
  }

  async function releasePayout() {
    if (!selectedSessionId || !payoutUserId) return;
    setPayoutResult(null);
    const res = await fetch("/api/admin/payouts/release", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tontineSessionId: selectedSessionId, userId: payoutUserId }),
    });
    const body = await res.json();
    if (!res.ok) {
      setPayoutResult(body.error ?? "Failed to release payout");
      return;
    }
    setPayoutResult(
      `Pot: ${body.pot.toLocaleString("en-US")} F — Fines deducted: ${body.deducted.toLocaleString("en-US")} F — Net payout: ${body.netPayout.toLocaleString("en-US")} F`,
    );
    if (selectedSessionId) {
      fetch(`/api/admin/sessions/${selectedSessionId}/ledger`).then((r) => r.json()).then(setLedger);
    }
  }

  const selectedSession = sessions.find((s) => s.id === selectedSessionId) ?? null;

  return (
    <main className="px-container-padding pt-stack-gap-lg pb-32 max-w-4xl mx-auto w-full flex flex-col gap-section-margin">
      <div>
        <div className="inline-flex items-center gap-2 bg-secondary-fixed-dim/20 text-on-secondary-fixed-variant px-3 py-1 rounded-full font-label-sm text-label-sm mb-2">
          <span className="material-symbols-outlined text-[16px]">shield</span>
          Présidente Control Center
        </div>
        <h2 className="font-display-lg text-display-lg text-primary">Admin Dashboard</h2>
        <p className="text-on-surface-variant font-body-lg mt-2">
          Manage tontine cycles, approve members, and oversee financial integrity.
        </p>
      </div>

      {/* Account approval queue */}
      <section>
        <div className="flex justify-between items-end mb-stack-gap-md">
          <h3 className="font-title-md text-title-md text-primary flex items-center gap-2">
            <span className="material-symbols-outlined">how_to_reg</span>
            Pending Approvals
          </h3>
          {accountQueue.length > 0 && (
            <span className="bg-error/10 text-error font-label-sm text-label-sm px-2 py-0.5 rounded-full">
              {accountQueue.length} Action Required
            </span>
          )}
        </div>
        {accountQueue.length === 0 ? (
          <p className="font-label-sm text-label-sm text-on-surface-variant">No pending accounts.</p>
        ) : (
          <div className="flex overflow-x-auto gap-stack-gap-md pb-4">
            {accountQueue.map((u) => (
              <div
                key={u.id}
                className="bg-surface rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] p-4 min-w-[280px] border border-outline-variant/30 flex flex-col"
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 rounded-full bg-tertiary-container text-on-tertiary flex items-center justify-center font-title-md text-title-md overflow-hidden">
                    {u.avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={u.avatar} alt={u.name} className="w-full h-full object-cover" />
                    ) : (
                      u.name.slice(0, 2).toUpperCase()
                    )}
                  </div>
                  <div>
                    <p className="font-label-md text-label-md text-on-surface">{u.name}</p>
                    <p className="font-label-sm text-label-sm text-on-surface-variant">
                      {u.city ?? "—"}
                      {u.neighborhood ? `, ${u.neighborhood}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 mt-auto">
                  <button
                    onClick={() => decideAccount(u, "reject")}
                    className="flex-1 bg-surface border border-outline-variant text-on-surface-variant font-label-md text-label-md py-2 rounded-lg hover:bg-surface-container-low active:scale-95 transition-all"
                  >
                    Reject
                  </button>
                  <button
                    onClick={() => decideAccount(u, "approve")}
                    className="flex-1 bg-primary text-on-primary font-label-md text-label-md py-2 rounded-lg hover:opacity-90 active:scale-95 transition-all shadow-sm"
                  >
                    Approve
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Pending tontine-membership requests */}
      <section>
        <div className="flex justify-between items-end mb-stack-gap-md">
          <h3 className="font-title-md text-title-md text-primary flex items-center gap-2">
            <span className="material-symbols-outlined">group_add</span>
            Pending Membership Requests
          </h3>
          {membershipQueue.length > 0 && (
            <span className="bg-error/10 text-error font-label-sm text-label-sm px-2 py-0.5 rounded-full">
              {membershipQueue.length} Action Required
            </span>
          )}
        </div>
        {membershipQueue.length === 0 ? (
          <p className="font-label-sm text-label-sm text-on-surface-variant">
            No pending tontine join requests.
          </p>
        ) : (
          <div className="flex flex-col gap-0 border border-outline-variant/30 rounded-lg overflow-hidden">
            {membershipQueue.map((m) => (
              <div
                key={m.id}
                className="flex justify-between items-center p-3 bg-surface-container-lowest border-b last:border-b-0 border-outline-variant/30"
              >
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
                    {m.user.name} wants to join{" "}
                    {TONTINE_LABELS[m.tontineSession.type] ?? m.tontineSession.type}
                  </p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => decideMembership(m, "reject")}
                    className="px-2 py-1 rounded border border-outline-variant text-on-surface-variant font-label-sm text-label-sm hover:bg-surface"
                  >
                    Reject
                  </button>
                  <button
                    onClick={() => decideMembership(m, "approve")}
                    className="px-2 py-1 rounded bg-primary text-on-primary font-label-sm text-label-sm hover:opacity-90"
                  >
                    Approve
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Session picker */}
      {sessions.length > 0 && (
        <div className="flex items-center gap-3">
          <label className="font-label-sm text-label-sm text-on-surface-variant">Session:</label>
          <select
            value={selectedSessionId ?? ""}
            onChange={(e) => setSelectedSessionId(e.target.value)}
            className="border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md bg-white"
          >
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {TONTINE_LABELS[s.type] ?? s.type} — {s.status}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-stack-gap-lg">
        {/* Ranking editor */}
        <section className="bg-surface rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] p-4 flex flex-col h-full">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-title-md text-title-md text-primary flex items-center gap-2">
              <span className="material-symbols-outlined">format_list_numbered</span>
              Payout Order
            </h3>
          </div>
          <p className="font-label-sm text-label-sm text-on-surface-variant mb-4">
            Drag to reorder, or use the arrows, then publish.
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
                  <p className="font-label-md text-label-md text-on-surface truncate">{m.name}</p>
                  {!m.hasPhone && (
                    <p className="font-label-sm text-label-sm text-error">No WhatsApp number on file</p>
                  )}
                </div>
                <div className="flex flex-col gap-0.5">
                  <button
                    aria-label="Move up"
                    onClick={() => moveItem(index, index - 1)}
                    className="text-outline hover:text-primary disabled:opacity-30"
                    disabled={index === 0}
                  >
                    <span className="material-symbols-outlined text-[18px]">keyboard_arrow_up</span>
                  </button>
                  <button
                    aria-label="Move down"
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
            disabled={publishing || order.length === 0}
            className="w-full bg-primary text-on-primary font-label-md text-label-md py-3 rounded-lg hover:opacity-90 active:scale-95 transition-all shadow-sm mt-auto disabled:opacity-60"
          >
            {publishing ? "Publishing..." : "Publish Official Ranking"}
          </button>
        </section>

        <div className="flex flex-col gap-stack-gap-lg">
          {/* Ledger */}
          <section className="bg-primary text-on-primary rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] p-4 relative overflow-hidden">
            <h3 className="font-title-md text-title-md flex items-center gap-2 mb-4 relative z-10">
              <span className="material-symbols-outlined">account_balance</span>
              Financial Ledger
            </h3>
            <div className="mb-4 relative z-10">
              <p className="font-label-sm text-label-sm text-primary-fixed-dim">Total Collected Fees</p>
              <p className="font-numeric-data text-numeric-data text-white">
                {(ledger?.totalFees ?? 0).toLocaleString("en-US")} F
              </p>
            </div>
            {ledger?.feeSplit && (
              <div className="bg-on-primary-fixed-variant/50 rounded-lg p-3 mb-4 backdrop-blur-sm relative z-10">
                <div className="flex justify-between items-center border-b border-primary-fixed-dim/20 pb-2 mb-2">
                  <span className="font-label-sm text-label-sm text-primary-fixed-dim">President</span>
                  <span className="font-label-md text-label-md text-white">
                    {ledger.feeSplit.president.toLocaleString("en-US")} F
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-label-sm text-label-sm text-primary-fixed-dim">Winner</span>
                  <span className="font-label-md text-label-md text-white">
                    {ledger.feeSplit.winner.toLocaleString("en-US")} F
                  </span>
                </div>
              </div>
            )}
            <div className="flex justify-between items-center bg-surface-container-lowest text-on-surface rounded-lg p-3 relative z-10 shadow-sm">
              <div className="flex items-center gap-2 text-error">
                <span className="material-symbols-outlined text-[20px]">warning</span>
                <span className="font-label-md text-label-md font-bold">Unpaid Fines</span>
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
              Swap Requests
            </h3>
            {swapRequests.length === 0 ? (
              <p className="font-label-sm text-label-sm text-on-surface-variant">No pending swap approvals.</p>
            ) : (
              <div className="flex flex-col gap-0 border border-outline-variant/30 rounded-lg overflow-hidden">
                {swapRequests.map((r) => (
                  <div
                    key={r.id}
                    className="flex justify-between items-center p-3 bg-surface-container-lowest border-b last:border-b-0 border-outline-variant/30"
                  >
                    <div>
                      <p className="font-label-md text-label-md text-on-surface">
                        Pos {r.requesterPosition ?? "?"}{" "}
                        <span className="material-symbols-outlined text-[14px] align-middle px-1">
                          arrow_forward
                        </span>{" "}
                        Pos {r.targetPosition ?? "?"}
                      </p>
                      <p className="font-label-sm text-label-sm text-on-surface-variant">
                        {r.requesterName} asks {r.targetName}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => decideSwap(r.id, "reject")}
                        className="px-2 py-1 rounded border border-outline-variant text-on-surface-variant font-label-sm text-label-sm hover:bg-surface"
                      >
                        Reject
                      </button>
                      <button
                        onClick={() => decideSwap(r.id, "approve")}
                        className="px-2 py-1 rounded bg-primary text-on-primary font-label-sm text-label-sm hover:opacity-90"
                      >
                        Approve
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Payout release */}
          {selectedSession && (
            <section className="bg-surface rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] p-4">
              <h3 className="font-title-md text-title-md text-primary flex items-center gap-2 mb-4">
                <span className="material-symbols-outlined">payments</span>
                Release Payout
              </h3>
              <div className="flex gap-2 mb-3">
                <select
                  value={payoutUserId}
                  onChange={(e) => setPayoutUserId(e.target.value)}
                  className="flex-1 border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md bg-white"
                >
                  <option value="">Select beneficiary…</option>
                  {selectedSession.memberships.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={releasePayout}
                  disabled={!payoutUserId}
                  className="bg-primary text-on-primary font-label-md text-label-md px-4 rounded-lg hover:opacity-90 disabled:opacity-50"
                >
                  Release
                </button>
              </div>
              {payoutResult && (
                <p className="font-label-sm text-label-sm text-on-surface-variant">{payoutResult}</p>
              )}
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
