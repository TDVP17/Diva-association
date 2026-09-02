"use client";

import { useEffect, useState } from "react";
import { translate, type Lang } from "@/lib/i18n/translations";
import { urlBase64ToUint8Array } from "@/lib/push/client";

const DISMISSED_KEY = "diva_push_prompt_dismissed";
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

/**
 * One-time, user-initiated opt-in for background push notifications —
 * deliberately never calls Notification.requestPermission() on its own;
 * browsers increasingly block/penalize permission prompts that aren't
 * triggered by a real click, so this only ever offers a button. Silently
 * renders nothing if VAPID isn't configured, push isn't supported, or the
 * browser already has a permission decision recorded (granted or denied —
 * "denied" can only be undone from browser settings, not by asking again).
 */
export function PushPermissionPrompt({ lang }: { lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => {
      if (!VAPID_PUBLIC_KEY) return;
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
      if (typeof Notification === "undefined" || Notification.permission !== "default") return;
      if (localStorage.getItem(DISMISSED_KEY)) return;
      setVisible(true);
    }, 0);
    return () => clearTimeout(handle);
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, "1");
    setVisible(false);
  }

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        dismiss();
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!) as BufferSource,
      });
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      dismiss();
    } catch (err) {
      console.error("[push] subscribe failed:", err);
      setError(t("pushEnableFailed"));
      setBusy(false);
    }
  }

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-20 md:bottom-4 z-40 flex justify-center px-container-padding pointer-events-none">
      <div className="w-full max-w-sm bg-surface rounded-xl shadow-xl border border-surface-variant p-4 flex items-start gap-3 pointer-events-auto">
        <span className="material-symbols-outlined text-primary flex-shrink-0">notifications_active</span>
        <div className="flex-1 min-w-0">
          <p className="font-label-md text-label-md text-on-surface">{t("pushPromptTitle")}</p>
          <p className="font-label-sm text-label-sm text-on-surface-variant mt-0.5">{t("pushPromptBody")}</p>
          {error && <p className="font-label-sm text-label-sm text-error mt-1">{error}</p>}
          <div className="flex gap-2 mt-2">
            <button
              onClick={dismiss}
              disabled={busy}
              className="px-3 py-1.5 rounded-lg text-on-surface-variant font-label-sm text-label-sm hover:bg-surface-variant/50 transition-colors disabled:opacity-60"
            >
              {t("notNow")}
            </button>
            <button
              onClick={enable}
              disabled={busy}
              className="px-3 py-1.5 rounded-lg bg-primary text-on-primary font-label-sm text-label-sm hover:opacity-90 transition-all disabled:opacity-60"
            >
              {busy ? t("submittingEllipsis") : t("pushEnableAction")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
