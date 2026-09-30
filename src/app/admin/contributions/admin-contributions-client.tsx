"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { translate, type Lang } from "@/lib/i18n/translations";
import { LoadingSpinner } from "@/components/loading-spinner";
import { formatXAF } from "@/lib/format-currency";
import { sessionStatusKey } from "@/lib/session-status-label";

interface ContributionCard {
  id: string;
  title: string;
  description?: string | null;
  type: string;
  status: string;
  totalMembers: number;
  paidMembers: number;
  unpaidMembers: number;
  expectedAmount: number;
  receivedAmount: number;
  outstandingAmount: number;
  finesPaid: number;
  finesOutstanding: number;
  notificationsSent: number;
  notificationsPending: number;
  notificationsFailed: number;
}

export function AdminContributionsClient({ lang }: { lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const [contributions, setContributions] = useState<ContributionCard[] | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/contributions/stats")
      .then((r) => r.json())
      .then((b) => setContributions(b.contributions ?? []));
  }, []);

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(t("deleteConfirmMessage"))) return;
    setDeletingId(id);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/admin/sessions/${id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDeleteError(body?.error || t("couldNotDeleteCotisation"));
        return;
      }
      setContributions((prev) => (prev ? prev.filter((c) => c.id !== id) : []));
    } catch {
      setDeleteError(t("couldNotDeleteCotisation"));
    } finally {
      setDeletingId(null);
    }
  }

  if (!contributions) {
    return <LoadingSpinner fullPage />;
  }

  if (contributions.length === 0) {
    return <p className="font-label-sm text-label-sm text-on-surface-variant">{t("noContributionsYet")}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {deleteError && (
        <div className="p-3 rounded-lg bg-error-container/40 border border-error/30 text-error text-xs md:text-sm font-medium">
          {deleteError}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-stack-gap-md">
        {contributions.map((c) => (
          <div
            key={c.id}
            className="group relative bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant p-4 hover:border-primary transition-all flex flex-col gap-3"
          >
            <div className="flex items-center justify-between gap-2">
              <Link
                href={`/admin/contributions/${c.id}`}
                className="font-title-sm text-title-sm text-on-surface hover:text-primary transition-colors truncate font-semibold flex-1"
              >
                {c.title}
              </Link>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-secondary-container/30 text-on-secondary-container font-label-sm text-label-sm">
                  {t(sessionStatusKey(c.status))}
                </span>
                <button
                  type="button"
                  onClick={(e) => handleDelete(e, c.id)}
                  disabled={deletingId === c.id}
                  title={t("delete")}
                  className="p-1 rounded-md text-slate-400 hover:text-error hover:bg-error/10 transition-colors disabled:opacity-50 flex items-center justify-center"
                >
                  <span className="material-symbols-outlined text-[18px]">
                    {deletingId === c.id ? "hourglass_empty" : "delete"}
                  </span>
                </button>
              </div>
            </div>
            {c.description && (
              <p className="font-body-sm text-xs text-on-surface-variant line-clamp-2 -mt-1">
                {c.description}
              </p>
            )}
            <Link href={`/admin/contributions/${c.id}`} className="grid grid-cols-2 gap-2">
              <Stat label={t("membersLabel")} value={`${c.paidMembers}/${c.totalMembers}`} />
              <Stat label={t("receivedLabel")} value={formatXAF(c.receivedAmount)} />
              <Stat label={t("outstandingLabel")} value={formatXAF(c.outstandingAmount)} />
              <Stat label={t("finesOutstandingLabel")} value={formatXAF(c.finesOutstanding)} />
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-label-sm text-label-sm text-on-surface-variant">{label}</p>
      <p className="font-label-md text-label-md text-on-surface">{value}</p>
    </div>
  );
}
