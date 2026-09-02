"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { translate, type Lang } from "@/lib/i18n/translations";
import { getInitials } from "@/lib/initials";

type SwapStatus = "PENDING_MEMBERSHIP" | "PENDING_ADMIN" | "APPROVED" | "REJECTED";

interface CoMember {
  userId: string;
  name: string;
  avatar: string | null;
  position: number | null;
}

interface PendingSwap {
  id: string;
  requesterId: string;
  targetId: string;
  requesterName: string;
  targetName: string;
  status: SwapStatus;
}

/**
 * Position-exchange requests, relocated here from the (now admin-only)
 * chat thread — this is the only place two co-members ever interacted
 * outside of admin support, so it needed a new home once peer-to-peer
 * messaging was removed. The request/respond API (src/app/api/chat/
 * swap-requests/*) is unchanged; only the trigger UI moved.
 */
export function SwapRequestPanel({
  tontineSessionId,
  currentUserId,
  myPosition,
  coMembers,
  pendingRequests,
  lang,
}: {
  tontineSessionId: string;
  currentUserId: string;
  myPosition: number | null;
  coMembers: CoMember[];
  pendingRequests: PendingSwap[];
  lang: Lang;
}) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const router = useRouter();
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A co-member already tied up in an open request with anyone can't be
  // re-requested — mirrors the API's own "one pending pair" constraint.
  const busyUserIds = new Set(
    pendingRequests
      .filter((r) => r.status === "PENDING_MEMBERSHIP" || r.status === "PENDING_ADMIN")
      .flatMap((r) => [r.requesterId, r.targetId]),
  );
  const requestable = coMembers.filter((m) => !busyUserIds.has(m.userId));

  async function requestExchange(targetId: string) {
    setPendingActionId(targetId);
    setError(null);
    try {
      const res = await fetch("/api/chat/swap-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId, tontineSessionId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? t("somethingWentWrong"));
        return;
      }
      router.refresh();
    } finally {
      setPendingActionId(null);
    }
  }

  async function respond(id: string, action: "accept" | "decline") {
    setPendingActionId(id);
    setError(null);
    try {
      const res = await fetch(`/api/chat/swap-requests/${id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? t("somethingWentWrong"));
        return;
      }
      router.refresh();
    } finally {
      setPendingActionId(null);
    }
  }

  const swapStatusLabel: Record<SwapStatus, string> = {
    PENDING_MEMBERSHIP: t("swapAwaitingYourResponse"),
    PENDING_ADMIN: t("swapPendingAdminApproval"),
    APPROVED: t("swapApproved"),
    REJECTED: t("swapDeclined"),
  };

  if (requestable.length === 0 && pendingRequests.length === 0) return null;

  return (
    <section className="mb-stack-gap-lg">
      <h2 className="font-title-md text-title-md text-on-surface mb-stack-gap-md px-1">
        {t("positionExchangeSectionTitle")}
      </h2>
      <div className="bg-surface rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant p-4 flex flex-col gap-3">
        {error && <p className="font-label-sm text-label-sm text-error">{error}</p>}

        {pendingRequests.length > 0 && (
          <div className="flex flex-col gap-2">
            {pendingRequests.map((r) => {
              const isTarget = r.targetId === currentUserId;
              const otherName = isTarget ? r.requesterName : r.targetName;
              return (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-2 bg-surface-container-low rounded-lg px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="font-label-md text-label-md text-on-surface truncate">{otherName}</p>
                    <p className="font-label-sm text-label-sm text-on-surface-variant">{swapStatusLabel[r.status]}</p>
                  </div>
                  {isTarget && r.status === "PENDING_MEMBERSHIP" && (
                    <div className="flex gap-2 flex-shrink-0">
                      <button
                        onClick={() => respond(r.id, "decline")}
                        disabled={pendingActionId === r.id}
                        className="px-3 py-1.5 rounded-lg border border-outline-variant text-on-surface-variant font-label-sm text-label-sm hover:bg-surface transition-colors disabled:opacity-60"
                      >
                        {t("declineAction")}
                      </button>
                      <button
                        onClick={() => respond(r.id, "accept")}
                        disabled={pendingActionId === r.id}
                        className="px-3 py-1.5 rounded-lg bg-primary text-on-primary font-label-sm text-label-sm hover:opacity-90 transition-opacity disabled:opacity-60"
                      >
                        {t("acceptAction")}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {requestable.length > 0 && (
          <div className="flex flex-col gap-2">
            {requestable.map((m) => (
              <div key={m.userId} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-surface-container-high text-primary flex items-center justify-center font-label-sm text-label-sm overflow-hidden flex-shrink-0">
                    {m.avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.avatar} alt={m.name} className="w-full h-full object-cover" />
                    ) : (
                      getInitials(m.name)
                    )}
                  </div>
                  <span className="font-label-md text-label-md text-on-surface truncate">{m.name}</span>
                </div>
                <button
                  onClick={() => requestExchange(m.userId)}
                  disabled={pendingActionId === m.userId}
                  className="flex-shrink-0 px-3 py-1.5 rounded-full bg-secondary-fixed-dim bg-opacity-20 text-on-secondary-container border border-secondary-fixed-dim hover:bg-opacity-30 transition-colors font-label-sm text-label-sm flex items-center gap-1.5 disabled:opacity-60"
                >
                  <span className="material-symbols-outlined text-[16px]">swap_horiz</span>
                  {t("requestExchangeLabel", { mine: String(myPosition ?? "?"), theirs: String(m.position ?? "?") })}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
