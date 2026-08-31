"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { translate, type Lang } from "@/lib/i18n/translations";
import { renderNotificationMessage } from "@/lib/notifications/render-message";

interface NotificationRow {
  id: string;
  type: string;
  message: string;
  messageKey: string | null;
  messageVars: unknown;
  contributionLabel: string | null;
  actionUrl: string | null;
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
  SWAP_REQUEST_CREATED: "notifTypeSwapRequestCreated",
  SWAP_REQUEST_PENDING_ADMIN: "notifTypeSwapRequestPendingAdmin",
  SWAP_REQUEST_APPROVED: "notifTypeSwapRequestApproved",
  SWAP_REQUEST_REJECTED: "notifTypeSwapRequestRejected",
  NEW_MEMBERSHIP_REQUEST: "notifTypeNewMembershipRequest",
  DRAW_LAUNCHED: "notifTypeDrawLaunched",
};

export function NotificationsClient({ lang }: { lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const router = useRouter();
  const [notifications, setNotifications] = useState<NotificationRow[] | null>(null);

  useEffect(() => {
    fetch("/api/notifications")
      .then((r) => r.json())
      .then((b) => setNotifications(b.notifications ?? []));
  }, []);

  async function markRead(id: string) {
    setNotifications((current) => (current ? current.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)) : current));
    await fetch(`/api/notifications/${id}/read`, { method: "POST" });
    // Refreshes the server-rendered header bell badge so the unread count
    // drops instantly instead of waiting for the next full navigation.
    router.refresh();
  }

  async function dismiss(id: string) {
    setNotifications((current) => (current ? current.filter((n) => n.id !== id) : current));
    await fetch(`/api/notifications/${id}`, { method: "DELETE" });
    router.refresh();
  }

  async function clearAll() {
    if (!window.confirm(t("confirmClearAllNotifications"))) return;
    setNotifications([]);
    await fetch("/api/notifications", { method: "DELETE" });
    router.refresh();
  }

  function handleClick(n: NotificationRow) {
    if (!n.readAt) markRead(n.id);
    if (n.actionUrl) router.push(n.actionUrl);
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
      <div className="flex justify-end">
        <button
          onClick={clearAll}
          className="font-label-sm text-label-sm text-on-surface-variant hover:text-error transition-colors px-2 py-1"
        >
          {t("clearAllNotifications")}
        </button>
      </div>
      {notifications.map((n) => (
        <div
          key={n.id}
          className={`relative bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border p-4 flex flex-col gap-1 transition-colors ${
            n.readAt ? "border-surface-variant" : "border-primary bg-primary/5"
          }`}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              dismiss(n.id);
            }}
            aria-label={t("dismissNotification")}
            className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-low hover:text-error transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
          <button onClick={() => handleClick(n)} className="text-left flex flex-col gap-1 pr-6">
            <div className="flex items-center justify-between gap-2">
              <span className="font-label-md text-label-md text-primary">{t(TYPE_KEY[n.type] ?? "notifTypeAdminBroadcast")}</span>
              {!n.readAt && <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />}
            </div>
            {n.contributionLabel && (
              <p className="font-label-sm text-label-sm text-on-surface-variant">{n.contributionLabel}</p>
            )}
            <p className="font-body-md text-body-md text-on-surface whitespace-pre-wrap">
              {renderNotificationMessage(n, lang)}
            </p>
            <p className="font-label-sm text-label-sm text-on-surface-variant mt-1">
              {new Date(n.sentAt).toLocaleString("en-GB", { timeZone: "Africa/Douala" })}
            </p>
          </button>
        </div>
      ))}
    </div>
  );
}
