"use client";

/**
 * Thin wrapper around the Badging API (navigator.setAppBadge/clearAppBadge)
 * — shows the unread count as a red badge on the installed PWA's home
 * screen/taskbar icon. Not supported everywhere (notably iOS Safari has no
 * Badging API at all): feature-detected and silently a no-op where absent,
 * never throws.
 */
export function updateAppBadge(count: number): void {
  const nav = navigator as Navigator & {
    setAppBadge?: (count?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  if (!nav.setAppBadge || !nav.clearAppBadge) return;

  const action = count > 0 ? nav.setAppBadge(count) : nav.clearAppBadge();
  action.catch(() => {
    // Unsupported in this browser/context — nothing else to do.
  });
}
