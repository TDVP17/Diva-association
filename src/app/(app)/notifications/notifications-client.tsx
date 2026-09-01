"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { translate, type Lang } from "@/lib/i18n/translations";
import { renderNotificationMessage } from "@/lib/notifications/render-message";
import { LoadingSpinner } from "@/components/loading-spinner";
import { NOTIFICATION_TYPE_KEY as TYPE_KEY } from "@/lib/notifications/type-labels";

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

export function NotificationsClient({ lang }: { lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const router = useRouter();
  const [notifications, setNotifications] = useState<NotificationRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/notifications")
      .then((r) => {
        if (!r.ok) throw new Error(`Request failed with status ${r.status}`);
        return r.json();
      })
      .then((b) => {
        if (cancelled) return;
        setNotifications(b.notifications ?? []);
        setLoadError(false);
      })
      .catch((err) => {
        console.error("[notifications] failed to load:", err);
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

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

  if (loadError) {
    return (
      <div className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant p-5 text-center flex flex-col items-center gap-stack-gap-sm">
        <p className="font-body-md text-body-md text-error">{t("couldNotLoadNotifications")}</p>
        <button
          onClick={() => setReloadToken((n) => n + 1)}
          className="px-4 py-2 rounded-lg border border-outline-variant text-primary font-label-md text-label-md hover:bg-surface-container-low transition-colors"
        >
          {t("tryAgain")}
        </button>
      </div>
    );
  }

  if (!notifications) {
    return <LoadingSpinner fullPage />;
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
