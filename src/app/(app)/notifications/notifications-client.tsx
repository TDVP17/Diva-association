"use client";

import { useEffect, useState } from "react";
import { translate, type Lang } from "@/lib/i18n/translations";

interface NotificationRow {
  id: string;
  type: string;
  message: string;
  contributionLabel: string | null;
  sentAt: string;
  readAt: string | null;
}

const TYPE_KEY: Record<string, Parameters<typeof translate>[1]> = {
  CONTRIBUTION_REMINDER: "notifTypeContributionReminder",
  FINE_REMINDER: "notifTypeFineReminder",
  FOOD_TURN: "notifTypeFoodTurn",
  PAYMENT_SUCCESS: "notifTypePaymentSuccess",
  ADMIN_BROADCAST: "notifTypeAdminBroadcast",
  MEMBER_APPROVED: "notifTypeMemberApproved",
  MEMBER_REJECTED: "notifTypeMemberRejected",
};

export function NotificationsClient({ lang }: { lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const [notifications, setNotifications] = useState<NotificationRow[] | null>(null);

  useEffect(() => {
    fetch("/api/notifications")
      .then((r) => r.json())
      .then((b) => setNotifications(b.notifications ?? []));
  }, []);

  async function markRead(id: string) {
    setNotifications((current) => (current ? current.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)) : current));
    await fetch(`/api/notifications/${id}/read`, { method: "POST" });
  }

  if (!notifications) {
    return <p className="font-label-sm text-label-sm text-on-surface-variant">…</p>;
  }

  if (notifications.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant p-5 text-center">
        <p className="font-body-md text-body-md text-on-surface-variant">{t("noNotificationsYet")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {notifications.map((n) => (
        <button
          key={n.id}
          onClick={() => !n.readAt && markRead(n.id)}
          className={`text-left bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border p-4 flex flex-col gap-1 transition-colors ${
            n.readAt ? "border-surface-variant" : "border-primary bg-primary/5"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-label-md text-label-md text-primary">{t(TYPE_KEY[n.type] ?? "notifTypeAdminBroadcast")}</span>
            {!n.readAt && <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />}
          </div>
          {n.contributionLabel && (
            <p className="font-label-sm text-label-sm text-on-surface-variant">{n.contributionLabel}</p>
          )}
          <p className="font-body-md text-body-md text-on-surface whitespace-pre-wrap">{n.message}</p>
          <p className="font-label-sm text-label-sm text-on-surface-variant mt-1">
            {new Date(n.sentAt).toLocaleString("en-GB", { timeZone: "Africa/Douala" })}
          </p>
        </button>
      ))}
    </div>
  );
}
