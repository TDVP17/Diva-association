"use client";

import { useRouter, usePathname } from "next/navigation";
import { translate, type Lang } from "@/lib/i18n/translations";

const MEMBER_ROOTS = new Set(["/dashboard", "/sessions", "/chat", "/profile"]);
const ADMIN_ROOTS = new Set([
  "/admin",
  "/admin/notifications",
  "/admin/support",
  "/admin/analytics",
  "/admin/settings",
]);

/**
 * Shown on every page except the tab roots (already reachable via the
 * bottom nav / sidebar, so a back button there would be redundant). Placed
 * once in each area's layout instead of per-page, so newly added nested
 * routes get it automatically.
 */
export function BackBar({ lang, area }: { lang: Lang; area: "member" | "admin" }) {
  const pathname = usePathname();
  const router = useRouter();
  const roots = area === "admin" ? ADMIN_ROOTS : MEMBER_ROOTS;

  if (roots.has(pathname)) return null;

  return (
    <div className="px-container-padding pt-3">
      <button
        type="button"
        onClick={() => router.back()}
        className="inline-flex items-center gap-1 font-label-md text-label-md text-on-surface-variant hover:text-primary transition-colors -ml-1 px-1 py-1 rounded"
      >
        <span className="material-symbols-outlined text-[20px]">arrow_back</span>
        {translate(lang, "goBack")}
      </button>
    </div>
  );
}
