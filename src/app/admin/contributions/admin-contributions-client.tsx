"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { translate, type Lang } from "@/lib/i18n/translations";
import { LoadingSpinner } from "@/components/loading-spinner";
import { formatXAF } from "@/lib/format-currency";

interface ContributionCard {
  id: string;
  title: string;
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

  useEffect(() => {
    fetch("/api/admin/contributions/stats")
      .then((r) => r.json())
      .then((b) => setContributions(b.contributions ?? []));
  }, []);

  if (!contributions) {
    return <LoadingSpinner fullPage />;
  }

  if (contributions.length === 0) {
    return <p className="font-label-sm text-label-sm text-on-surface-variant">{t("noContributionsYet")}</p>;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-stack-gap-md">
      {contributions.map((c) => (
        <Link
          key={c.id}
          href={`/admin/contributions/${c.id}`}
          className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant p-4 hover:border-primary transition-colors flex flex-col gap-3"
        >
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-title-sm text-title-sm text-on-surface truncate">{c.title}</h4>
            <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-secondary-container/30 text-on-secondary-container font-label-sm text-label-sm flex-shrink-0">
              {c.status}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Stat label={t("membersLabel")} value={`${c.paidMembers}/${c.totalMembers}`} />
            <Stat label={t("receivedLabel")} value={formatXAF(c.receivedAmount)} />
            <Stat label={t("outstandingLabel")} value={formatXAF(c.outstandingAmount)} />
            <Stat label={t("finesOutstandingLabel")} value={formatXAF(c.finesOutstanding)} />
          </div>
        </Link>
      ))}
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
