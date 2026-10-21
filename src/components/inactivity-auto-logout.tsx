"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// 365 days in milliseconds (1 full year of inactivity)
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const STORAGE_KEY = "diva_last_connected_at";

/**
 * Client-side watcher that enforces auto-logout only after 1 full year (365 days)
 * of continuous inactivity. Checks on mount, on PWA app resume, and window focus.
 */
export function InactivityAutoLogout() {
  const router = useRouter();

  useEffect(() => {
    // Clean up legacy PIN code if present
    try {
      localStorage.removeItem("diva_biometric_pin_hash");
    } catch {}

    function verifyInactivityAndTouch() {
      const now = Date.now();
      const raw = localStorage.getItem(STORAGE_KEY);

      if (raw) {
        const lastConnected = Number(raw);
        if (!isNaN(lastConnected) && lastConnected > 0) {
          const elapsed = now - lastConnected;
          if (elapsed > ONE_YEAR_MS) {
            // More than 1 year without connecting -> auto-disconnect
            localStorage.removeItem(STORAGE_KEY);
            // Trigger server signout and redirect to login with expiration notice
            window.location.href = "/login?expired=1";
            return;
          }
        }
      }

      // Update timestamp on active session
      localStorage.setItem(STORAGE_KEY, String(now));
    }

    // Verify immediately on component mount (initial page load / PWA open)
    verifyInactivityAndTouch();

    // Verify when the app comes back to foreground (e.g. mobile PWA resume)
    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        verifyInactivityAndTouch();
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", verifyInactivityAndTouch);

    // Throttle activity updates so we don't write to storage on every click
    let lastTouch = Date.now();
    function onUserInteraction() {
      const now = Date.now();
      if (now - lastTouch > 5 * 60 * 1000) {
        // Every 5 minutes of active usage
        lastTouch = now;
        localStorage.setItem(STORAGE_KEY, String(now));
      }
    }

    window.addEventListener("click", onUserInteraction, { passive: true });
    window.addEventListener("keydown", onUserInteraction, { passive: true });
    window.addEventListener("touchstart", onUserInteraction, { passive: true });

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", verifyInactivityAndTouch);
      window.removeEventListener("click", onUserInteraction);
      window.removeEventListener("keydown", onUserInteraction);
      window.removeEventListener("touchstart", onUserInteraction);
    };
  }, [router]);

  return null;
}
