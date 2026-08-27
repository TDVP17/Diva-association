"use client";

import { useEffect } from "react";
import { updateAppBadge } from "@/lib/notification-badge";

const POLL_MS = 60 * 1000;

/**
 * Mounted once in each app shell (member + admin) — keeps the installed
 * PWA's home-screen icon badge in sync with the unread-notification count.
 * Purely a side effect (no rendered UI, no React state), so it's safe to
 * run this fetch/update cycle directly inside the effect.
 */
export function NotificationBadgeSync() {
  useEffect(() => {
    let cancelled = false;

    function sync() {
      fetch("/api/notifications/unread-count")
        .then((r) => (r.ok ? r.json() : null))
        .then((body) => {
          if (!cancelled && body) updateAppBadge(body.count);
        })
        .catch(() => {
          // Best-effort only — a failed poll just tries again next cycle.
        });
    }

    sync();
    const interval = setInterval(sync, POLL_MS);
    document.addEventListener("visibilitychange", sync);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  return null;
}
