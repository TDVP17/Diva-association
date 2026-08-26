"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { translate, type Lang } from "@/lib/i18n/translations";

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

const TONTINE_LABELS: Record<string, string> = {
  HEBDO_SUNDAY: "Weekly Tontine",
  MONTHLY_28: "Monthly Tontine (28th)",
  MONTHLY_25: "Monthly Tontine (25th)",
};

export function AdminDashboardClient({ lang }: { lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const [membershipQueue, setMembershipQueue] = useState<MembershipRequest[]>([]);
  const [contributions, setContributions] = useState<ContributionCard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/membership-queue")
      .then((r) => r.json())
      .then((b) => setMembershipQueue(b.memberships ?? []));
    fetch("/api/admin/contributions/stats")
      .then((r) => r.json())
      .then((b) => {
        setContributions(b.contributions ?? []);
        setLoading(false);
      });
  }, []);

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

  return (
    <main className="px-container-padding pt-stack-gap-lg pb-32 max-w-4xl mx-auto w-full flex flex-col gap-section-margin">
      <div>
        <div className="inline-flex items-center gap-2 bg-secondary-fixed-dim/20 text-on-secondary-fixed-variant px-3 py-1 rounded-full font-label-sm text-label-sm mb-2">
          <span className="material-symbols-outlined text-[16px]">shield</span>
          {t("adminControlCenter")}
        </div>
        <h2 className="font-display-lg text-display-lg text-primary">{t("adminDashboard")}</h2>
        <p className="text-on-surface-variant font-body-lg mt-2">{t("adminDashboardSubtitle")}</p>
      </div>

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

      <section>
        <div className="flex justify-between items-end mb-stack-gap-md">
          <h3 className="font-title-md text-title-md text-primary flex items-center gap-2">
            <span className="material-symbols-outlined">account_balance</span>
            {t("contributionsNav")}
          </h3>
          <Link
            href="/admin/sessions/new"
            className="px-3 py-2 rounded-lg bg-primary text-on-primary font-label-sm text-label-sm hover:opacity-90 flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            {t("newCotisation")}
          </Link>
        </div>

        {loading ? (
          <p className="font-label-sm text-label-sm text-on-surface-variant">…</p>
        ) : contributions.length === 0 ? (
          <p className="font-label-sm text-label-sm text-on-surface-variant">{t("noContributionsYet")}</p>
        ) : (
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
                  <Stat label={t("receivedLabel")} value={`${c.receivedAmount.toLocaleString("en-US")} F`} />
                  <Stat label={t("outstandingLabel")} value={`${c.outstandingAmount.toLocaleString("en-US")} F`} />
                  <Stat label={t("finesOutstandingLabel")} value={`${c.finesOutstanding.toLocaleString("en-US")} F`} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
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
