"use client";

import { useEffect } from "react";
import { updateAppBadge } from "@/lib/notification-badge";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Mounted once in each app shell (member + admin) — keeps the installed
 * PWA's home-screen icon badge in sync with the unread-notification count.
 * Étape 1 (STOP CPU): le polling setInterval(60000ms) a été remplacé par
 * une écoute Supabase Realtime sur la table `notifications`.
 */
export function NotificationBadgeSync({ userId }: { userId?: string }) {
  useEffect(() => {
    let cancelled = false;

    function sync() {
      fetch("/api/notifications/unread-count")
        .then((r) => (r.ok ? r.json() : null))
        .then((body) => {
          if (!cancelled && body) updateAppBadge(body.count);
        })
        .catch(() => {
          // Best-effort only.
        });
    }

    function handleVisibility() {
      if (document.visibilityState === "visible") {
        sync();
      }
    }

    sync();
    document.addEventListener("visibilitychange", handleVisibility);

    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      ? supabase
        .channel(userId ? `notifications:${userId}` : "notifications")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "notifications",
            ...(userId ? { filter: `userId=eq.${userId}` } : {}),
          },
          () => {
            sync();
          },
        )
        .subscribe()
      : null;

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      if (supabase && channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [userId]);

  return null;
}
