"use client";

import { useEffect, useState } from "react";
import { translate, type Lang } from "@/lib/i18n/translations";
import { NOTIFICATION_TYPE_KEY, NOTIFICATION_STATUS_KEY } from "@/lib/notifications/type-labels";
import { LoadingSpinner } from "@/components/loading-spinner";

interface NotificationRow {
  id: string;
  userName: string;
  contributionLabel: string | null;
  channel: string;
  type: string;
  status: string;
  scheduledAt: string;
  sentAt: string | null;
  errorMessage: string | null;
}

interface ContributionOption {
  id: string;
  label: string;
}

const STATUS_CLASS: Record<string, string> = {
  SENT: "bg-[#d1fae5] text-[#065f46]",
  FAILED: "bg-error-container text-on-error-container",
  PENDING: "bg-secondary-fixed text-on-secondary-fixed-variant",
  SCHEDULED: "bg-secondary-fixed text-on-secondary-fixed-variant",
  PROCESSING: "bg-secondary-container/40 text-on-secondary-container",
};

export function AdminNotificationsClient({ lang }: { lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [contributions, setContributions] = useState<ContributionOption[]>([]);
  const [tontineSessionId, setTontineSessionId] = useState("");
  const [channel, setChannel] = useState("");
  const [status, setStatus] = useState("");
  const [member, setMember] = useState("");
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams();
    if (tontineSessionId) params.set("tontineSessionId", tontineSessionId);
    if (channel) params.set("channel", channel);
    if (status) params.set("status", status);
    if (member.trim()) params.set("member", member.trim());

    let cancelled = false;
    const handle = setTimeout(() => {
      setLoading(true);
      setLoadError(false);
      fetch(`/api/admin/notifications?${params.toString()}`)
        .then((r) => {
          if (!r.ok) throw new Error(`Request failed with status ${r.status}`);
          return r.json();
        })
        .then((b) => {
          if (cancelled) return;
          setNotifications(b.notifications ?? []);
          setContributions(b.contributions ?? []);
        })
        .catch((err) => {
          console.error("[admin-notifications] failed to load:", err);
          if (!cancelled) setLoadError(true);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [tontineSessionId, channel, status, member, reloadToken]);

  return (
    <main className="px-container-padding pt-stack-gap-lg pb-32 max-w-4xl mx-auto w-full flex flex-col gap-stack-gap-lg">
      <div>
        <h2 className="font-headline-lg-mobile text-headline-lg-mobile md:font-headline-lg md:text-headline-lg text-primary">
          {t("notificationCenter")}
        </h2>
        <p className="text-on-surface-variant font-body-lg mt-2">{t("notificationCenterSubtitle")}</p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={tontineSessionId}
          onChange={(e) => setTontineSessionId(e.target.value)}
          className="border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md bg-white"
        >
          <option value="">{t("allContributions")}</option>
          {contributions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <select
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
          className="border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md bg-white"
        >
          <option value="">{t("allChannels")}</option>
          <option value="EMAIL">Email</option>
          <option value="WHATSAPP">WhatsApp</option>
          <option value="IN_APP">{t("notifChannelInApp")}</option>
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md bg-white"
        >
          <option value="">{t("allStatuses")}</option>
          <option value="SENT">{t("notifStatusSent")}</option>
          <option value="SCHEDULED">{t("notifStatusScheduled")}</option>
          <option value="PROCESSING">{t("notifStatusProcessing")}</option>
          <option value="FAILED">{t("notifStatusFailed")}</option>
        </select>
        <input
          value={member}
          onChange={(e) => setMember(e.target.value)}
          placeholder={t("filterByMember")}
          className="border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md bg-white flex-1 min-w-[160px]"
        />
      </div>

      {loadError ? (
        <div className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant p-5 text-center flex flex-col items-center gap-stack-gap-sm">
          <p className="font-body-md text-body-md text-error">{t("couldNotLoadNotifications")}</p>
          <button
            onClick={() => setReloadToken((n) => n + 1)}
            className="px-4 py-2 rounded-lg border border-outline-variant text-primary font-label-md text-label-md hover:bg-surface-container-low transition-colors"
          >
            {t("tryAgain")}
          </button>
        </div>
      ) : loading ? (
        <LoadingSpinner />
      ) : notifications.length === 0 ? (
        <p className="font-label-sm text-label-sm text-on-surface-variant">{t("noneYet")}</p>
      ) : (
        <div className="bg-surface rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-outline-variant/30 overflow-hidden">
          {notifications.map((n, i) => (
            <div
              key={n.id}
              className={`flex items-center justify-between p-3 bg-surface-container-lowest ${i < notifications.length - 1 ? "border-b border-outline-variant/30" : ""}`}
            >
              <div className="min-w-0">
                <p className="font-label-md text-label-md text-on-surface truncate">
                  {n.userName} · {n.channel}
                </p>
                <p className="font-label-sm text-label-sm text-on-surface-variant truncate">
                  {n.contributionLabel ? `${n.contributionLabel} — ` : ""}
                  {NOTIFICATION_TYPE_KEY[n.type] ? t(NOTIFICATION_TYPE_KEY[n.type]) : n.type} —{" "}
                  {new Date(n.sentAt ?? n.scheduledAt).toLocaleString("en-GB", { timeZone: "Africa/Douala" })}
                  {n.errorMessage && ` — ${n.errorMessage}`}
                </p>
              </div>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-md font-label-sm text-label-sm flex-shrink-0 ml-2 ${STATUS_CLASS[n.status]}`}>
                {NOTIFICATION_STATUS_KEY[n.status] ? t(NOTIFICATION_STATUS_KEY[n.status]) : n.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
