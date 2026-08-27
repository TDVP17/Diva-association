"use client";

import { useEffect, useState } from "react";
import { translate, type Lang } from "@/lib/i18n/translations";

interface SwapRequestRow {
  id: string;
  requesterName: string;
  targetName: string;
  tontineSessionId: string;
  tontineType: string;
  requesterPosition: number | null;
  targetPosition: number | null;
}

/**
 * Global, cross-session view of every position-exchange request awaiting
 * admin approval — self-fetching from /api/admin/swap-requests (already
 * returns every PENDING_ADMIN row, not scoped to one cotisation). This is
 * now the single place this UI lives; the per-session Notifications tab
 * links here instead of duplicating it.
 */
export function SwapRequestPanel({ lang }: { lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const [requests, setRequests] = useState<SwapRequestRow[] | null>(null);

  function refresh() {
    fetch("/api/admin/swap-requests")
      .then((r) => r.json())
      .then((b) => setRequests(b.requests ?? []));
  }

  useEffect(() => {
    refresh();
  }, []);

  async function decide(id: string, action: "approve" | "reject") {
    setRequests((rows) => (rows ? rows.filter((r) => r.id !== id) : rows));
    await fetch(`/api/admin/swap-requests/${id}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    refresh();
  }

  if (!requests) {
    return <p className="font-label-sm text-label-sm text-on-surface-variant">…</p>;
  }

  if (requests.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant p-5 text-center">
        <p className="font-body-md text-body-md text-on-surface-variant">{t("noPendingSwaps")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0 border border-outline-variant/30 rounded-lg overflow-hidden">
      {requests.map((r) => (
        <div
          key={r.id}
          className="flex justify-between items-center p-3 bg-surface-container-lowest border-b last:border-b-0 border-outline-variant/30"
        >
          <div>
            <p className="font-label-md text-label-md text-on-surface">
              {t("positionAbbrev")} {r.requesterPosition ?? "?"}{" "}
              <span className="material-symbols-outlined text-[14px] align-middle px-1">arrow_forward</span>{" "}
              {t("positionAbbrev")} {r.targetPosition ?? "?"}
            </p>
            <p className="font-label-sm text-label-sm text-on-surface-variant">
              {t("userAsksUser", { requester: r.requesterName, target: r.targetName })}
            </p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={() => decide(r.id, "reject")}
              className="px-2 py-1 rounded border border-outline-variant text-on-surface-variant font-label-sm text-label-sm hover:bg-surface"
            >
              {t("reject")}
            </button>
            <button
              onClick={() => decide(r.id, "approve")}
              className="px-2 py-1 rounded bg-primary text-on-primary font-label-sm text-label-sm hover:opacity-90"
            >
              {t("approve")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
