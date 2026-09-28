"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { translate, type Lang } from "@/lib/i18n/translations";
import type { AdminNavCounts } from "./admin-sidebar";

const BASE_ITEMS = [
  { href: "/admin", label: "adminNavDashboard", icon: "space_dashboard" },
  { href: "/admin/notifications", label: "adminNavNotifications", icon: "notifications" },
  { href: "/admin/support", label: "adminNavSupport", icon: "support_agent" },
] as const;
const PRESIDENT_ITEM = { href: "/admin/analytics", label: "adminNavAnalytics", icon: "monitoring" } as const;
const SETTINGS_ITEM = { href: "/admin/settings", label: "adminNavSettings", icon: "settings" } as const;

export function AdminBottomNav({
  lang,
  isPresident,
  counts,
}: {
  lang: Lang;
  isPresident: boolean;
  counts?: AdminNavCounts;
}) {
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  const pathname = usePathname();
  const items = [...BASE_ITEMS, ...(isPresident ? [PRESIDENT_ITEM] : []), SETTINGS_ITEM];

  return (
    <nav className="fixed bottom-0 w-full z-50 rounded-t-xl border-t border-outline-variant shadow-[0px_-4px_20px_rgba(30,41,59,0.05)] bg-surface flex justify-around items-center h-20 pb-safe px-4 md:hidden">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const badge =
          item.href === "/admin/support"
            ? counts?.support
            : item.href === "/admin/notifications"
              ? counts?.notifications
              : undefined;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={
              active
                ? "flex flex-col items-center justify-center text-primary font-bold flex-1 h-full transition-colors active:scale-90 duration-200 relative"
                : "flex flex-col items-center justify-center text-on-surface-variant flex-1 h-full hover:bg-surface-container-low transition-colors active:scale-90 duration-200 relative"
            }
          >
            <div className="relative inline-flex items-center justify-center">
              <span
                className="material-symbols-outlined mb-1"
                style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}
              >
                {item.icon}
              </span>
              {!!badge && badge > 0 && (
                <span className="absolute -top-1 -right-2.5 bg-error text-on-error text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[16px] text-center leading-none">
                  {badge}
                </span>
              )}
            </div>
            <span className="font-label-sm text-label-sm">{t(item.label)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
