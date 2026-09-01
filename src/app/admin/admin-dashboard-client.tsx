"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { translate, type Lang } from "@/lib/i18n/translations";

interface DashboardCardProps {
  href: string;
  icon: string;
  title: string;
  body: string;
  /** Pending items needing admin action — shown as a red alert badge. */
  count: number | null;
  /** A neutral informational total (e.g. total registered users) — shown as a calm inline stat, never the red alert badge, since it isn't something needing action. */
  stat?: number | null;
}

function DashboardCard({ href, icon, title, body, count, stat }: DashboardCardProps) {
  return (
    <Link
      href={href}
      className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant p-5 hover:border-primary transition-colors flex flex-col gap-2 relative"
    >
      {!!count && (
        <span className="absolute top-4 right-4 bg-error text-on-error font-label-sm text-label-sm min-w-[22px] h-[22px] rounded-full flex items-center justify-center px-1.5">
          {count}
        </span>
      )}
      <div className="flex items-center justify-between">
        <span className="material-symbols-outlined text-primary text-3xl">{icon}</span>
        {stat != null && (
          <span className="font-numeric-data text-numeric-data text-primary">{stat.toLocaleString("fr-FR")}</span>
        )}
      </div>
      <h3 className="font-title-md text-title-md text-on-surface">{title}</h3>
      <p className="font-body-md text-body-md text-on-surface-variant">{body}</p>
    </Link>
  );
}

export function AdminDashboardClient({ lang }: { lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const [membershipCount, setMembershipCount] = useState<number | null>(null);
  const [contributionsCount, setContributionsCount] = useState<number | null>(null);
  const [swapCount, setSwapCount] = useState<number | null>(null);
  const [paymentIssueCount, setPaymentIssueCount] = useState<number | null>(null);
  const [totalUsersCount, setTotalUsersCount] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/admin/membership-queue")
      .then((r) => r.json())
      .then((b) => setMembershipCount((b.memberships ?? []).length));
    fetch("/api/admin/contributions/stats")
      .then((r) => r.json())
      .then((b) => setContributionsCount((b.contributions ?? []).length));
    fetch("/api/admin/swap-requests")
      .then((r) => r.json())
      .then((b) => setSwapCount((b.requests ?? []).length));
    fetch("/api/admin/payment-issues")
      .then((r) => r.json())
      .then((b) => setPaymentIssueCount((b.issues ?? []).filter((i: { status: string }) => i.status !== "REFUNDED").length));
    fetch("/api/admin/users")
      .then((r) => r.json())
      .then((b) => setTotalUsersCount(typeof b.total === "number" ? b.total : (b.users ?? []).length));
  }, []);

  return (
    <main className="px-container-padding pt-stack-gap-lg pb-32 max-w-4xl mx-auto w-full flex flex-col gap-section-margin">
      <div>
        <div className="inline-flex items-center gap-2 bg-secondary-fixed-dim/20 text-on-secondary-fixed-variant px-3 py-1 rounded-full font-label-sm text-label-sm mb-2">
          <span className="material-symbols-outlined text-[16px]">shield</span>
          {t("adminControlCenter")}
        </div>
        <p className="text-on-surface-variant font-body-lg">{t("adminDashboardSubtitle")}</p>
      </div>

      <Link
        href="/admin/sessions/new"
        className="w-full flex items-center justify-center gap-2 py-4 rounded-xl bg-primary text-on-primary font-title-sm text-title-sm hover:opacity-90 active:scale-[0.99] transition-all shadow-[0px_8px_30px_rgba(30,41,59,0.12)]"
      >
        <span className="material-symbols-outlined">add_circle</span>
        {t("createAndPublishNewCotisation")}
      </Link>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-stack-gap-md">
        <DashboardCard
          href="/admin/membership-requests"
          icon="group_add"
          title={t("cotisationMembershipRequestsCard")}
          body={t("cotisationMembershipRequestsCardBody")}
          count={membershipCount}
        />
        <DashboardCard
          href="/admin/contributions"
          icon="account_balance"
          title={t("myCotisationsCard")}
          body={t("myCotisationsCardBody")}
          count={contributionsCount}
        />
        <DashboardCard
          href="/admin/swap-requests"
          icon="swap_horiz"
          title={t("positionChangeRequestsCard")}
          body={t("positionChangeRequestsCardBody")}
          count={swapCount}
        />
        <DashboardCard
          href="/admin/users"
          icon="group"
          title={t("allUsersCard")}
          body={t("allUsersCardBody")}
          count={null}
          stat={totalUsersCount}
        />
        <DashboardCard
          href="/admin/payment-issues"
          icon="shield_person"
          title={t("paymentIssuesCard")}
          body={t("paymentIssuesCardBody")}
          count={paymentIssueCount}
        />
      </div>
    </main>
  );
}
