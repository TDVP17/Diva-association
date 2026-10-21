"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { translate, type Lang } from "@/lib/i18n/translations";
import { renderNotificationMessage } from "@/lib/notifications/render-message";
import { LoadingSpinner } from "@/components/loading-spinner";
import { NOTIFICATION_TYPE_KEY as TYPE_KEY } from "@/lib/notifications/type-labels";
import { urlBase64ToUint8Array } from "@/lib/push/client";
import { playUiTapSound } from "@/lib/sound-effects";

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

  const [pushStatus, setPushStatus] = useState<NotificationPermission | "unsupported">(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      return Notification.permission;
    }
    return "default";
  });
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(() => {
    if (typeof window !== "undefined") {
      return sessionStorage.getItem("diva_push_banner_dismissed") === "1";
    }
    return false;
  });

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setPushStatus(Notification.permission);
    } else {
      setPushStatus("unsupported");
    }
  }, []);

  function handleDismissBanner() {
    try {
      sessionStorage.setItem("diva_push_banner_dismissed", "1");
    } catch {}
    setBannerDismissed(true);
  }

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

  async function handleEnablePush() {
    playUiTapSound();
    setPushBusy(true);
    setPushMessage(null);
    try {
      const permission = await Notification.requestPermission();
      setPushStatus(permission);
      if (permission === "granted") {
        const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
        const reg = await navigator.serviceWorker.ready;
        let sub = await reg.pushManager.getSubscription();
        if (!sub && vapidKey) {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
          });
        }
        if (sub) {
          await fetch("/api/push/subscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(sub.toJSON()),
          });
        }
        setPushMessage(lang === "fr" ? "Notifications activées sur votre téléphone !" : "Notifications enabled on your phone!");
      } else {
        setPushMessage(lang === "fr" ? "Permission non accordée dans les paramètres." : "Permission denied in settings.");
      }
    } catch (err) {
      console.error("[push] enable failed:", err);
      setPushMessage(lang === "fr" ? "Impossible d'activer les notifications." : "Could not enable notifications.");
    } finally {
      setPushBusy(false);
    }
  }

  async function handleTestPush() {
    playUiTapSound();
    setPushBusy(true);
    setPushMessage(null);
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const data = await res.json();
      if (data.ok && data.sent > 0) {
        setPushMessage(lang === "fr" ? "Notification envoyée ! Regardez dans votre barre d'état." : "Notification sent! Check your notification bar.");
      } else {
        setPushMessage(lang === "fr" ? "Aucun appareil lié. Cliquez sur 'Activer' d'abord." : "No registered device. Click 'Enable' first.");
      }
    } catch (err) {
      console.error("[push] test failed:", err);
      setPushMessage(lang === "fr" ? "Erreur lors du test." : "Test failed.");
    } finally {
      setPushBusy(false);
    }
  }

  async function markRead(id: string) {
    setNotifications((current) => (current ? current.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)) : current));
    await fetch(`/api/notifications/${id}/read`, { method: "POST" });
    router.refresh();
  }

  async function markAllAsRead() {
    playUiTapSound();
    setNotifications((current) => (current ? current.map((n) => ({ ...n, readAt: new Date().toISOString() })) : current));
    await fetch("/api/notifications", { method: "PATCH" });
    router.refresh();
  }

  async function dismiss(id: string) {
    playUiTapSound();
    setNotifications((current) => (current ? current.filter((n) => n.id !== id) : current));
    await fetch(`/api/notifications/${id}`, { method: "DELETE" });
    router.refresh();
  }

  async function clearAll() {
    playUiTapSound();
    if (!window.confirm(t("confirmClearAllNotifications"))) return;
    setNotifications([]);
    await fetch("/api/notifications", { method: "DELETE" });
    router.refresh();
  }

  function handleClick(n: NotificationRow) {
    playUiTapSound();
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

  return (
    <div className="flex flex-col gap-3">
      {/* Phone system notification status card — only shown when not yet activated */}
      {pushStatus !== "unsupported" && pushStatus !== "granted" && !bannerDismissed && (
        <div className="bg-gradient-to-r from-[#064e3b] via-[#064e3b] to-[#043327] text-white rounded-2xl p-4 shadow-md border border-emerald-500/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 relative">
          <div className="flex items-start gap-3 pr-6 sm:pr-0">
            <span className="material-symbols-outlined text-amber-400 text-2xl flex-shrink-0 mt-0.5">
              notifications_paused
            </span>
            <div>
              <p className="font-bold text-sm text-white">
                {t("phoneNotificationsTitle")}
              </p>
              <p className="text-xs text-emerald-200/90 mt-0.5 leading-relaxed">
                {t("phoneNotificationsDesc")}
              </p>
              {pushMessage && (
                <p className="text-xs text-amber-300 font-semibold mt-1">
                  {pushMessage}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 w-full sm:w-auto">
            <button
              type="button"
              onClick={handleEnablePush}
              disabled={pushBusy}
              className="w-full sm:w-auto px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-emerald-950 font-bold text-xs transition-transform active:scale-95 shadow-sm cursor-pointer disabled:opacity-50"
            >
              {t("enablePhoneNotifications")}
            </button>
          </div>
          <button
            type="button"
            onClick={handleDismissBanner}
            aria-label="Fermer"
            className="absolute top-2.5 right-2.5 p-1 text-emerald-200/70 hover:text-white rounded-lg transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
      )}

      {notifications.length === 0 ? (
        <div className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant p-5 text-center">
          <p className="font-body-md text-body-md text-on-surface-variant">{t("noNotificationsYet")}</p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-end gap-3 px-1">
            {notifications.some((n) => !n.readAt) && (
              <button
                type="button"
                onClick={markAllAsRead}
                className="font-label-sm text-xs font-semibold text-emerald-700 hover:text-emerald-900 transition-colors px-2 py-1 cursor-pointer"
              >
                {t("markAllAsRead")}
              </button>
            )}
            <button
              type="button"
              onClick={clearAll}
              className="font-label-sm text-xs text-on-surface-variant hover:text-error transition-colors px-2 py-1 cursor-pointer"
            >
              {t("clearAllNotifications")}
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {notifications.map((n) => (
              <div
                key={n.id}
                className={`relative bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border p-3.5 flex flex-col gap-0.5 transition-colors ${
                  n.readAt ? "border-surface-variant" : "border-emerald-600/40 bg-emerald-50/20"
                }`}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    dismiss(n.id);
                  }}
                  aria-label={t("dismissNotification")}
                  className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-low hover:text-error transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleClick(n)}
                  className="text-left flex flex-col gap-0.5 pr-6 cursor-pointer"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-label-sm text-[11px] text-emerald-800 font-bold uppercase tracking-wide">
                      {t(TYPE_KEY[n.type] ?? "notifTypeAdminBroadcast")}
                    </span>
                    {!n.readAt && (
                      <span className="w-2 h-2 rounded-full bg-emerald-600 flex-shrink-0" />
                    )}
                  </div>
                  {n.contributionLabel && (
                    <p className="font-label-sm text-[11px] text-on-surface-variant font-medium">
                      {n.contributionLabel}
                    </p>
                  )}
                  <p className="font-body-sm text-xs text-on-surface whitespace-pre-wrap leading-relaxed mt-0.5">
                    {renderNotificationMessage(n, lang)}
                  </p>
                  <p className="font-label-sm text-[10px] text-on-surface-variant/70 mt-1">
                    {new Date(n.sentAt).toLocaleString("en-GB", { timeZone: "Africa/Douala" })}
                  </p>
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
