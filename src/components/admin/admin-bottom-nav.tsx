"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { translate, type Lang } from "@/lib/i18n/translations";

const BASE_ITEMS = [
  { href: "/admin", label: "adminNavDashboard", icon: "space_dashboard" },
  { href: "/admin/notifications", label: "adminNavNotifications", icon: "notifications" },
  { href: "/admin/support", label: "adminNavSupport", icon: "support_agent" },
] as const;
const PRESIDENT_ITEM = { href: "/admin/analytics", label: "adminNavAnalytics", icon: "monitoring" } as const;
const SETTINGS_ITEM = { href: "/admin/settings", label: "adminNavSettings", icon: "settings" } as const;

export function AdminBottomNav({ lang, isPresident }: { lang: Lang; isPresident: boolean }) {
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  const pathname = usePathname();
  const items = [...BASE_ITEMS, ...(isPresident ? [PRESIDENT_ITEM] : []), SETTINGS_ITEM];

  return (
    <nav className="fixed bottom-0 w-full z-50 rounded-t-xl border-t border-outline-variant shadow-[0px_-4px_20px_rgba(30,41,59,0.05)] bg-surface flex justify-around items-center h-20 pb-safe px-4 md:hidden">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={
              active
                ? "flex flex-col items-center justify-center text-primary font-bold flex-1 h-full transition-colors active:scale-90 duration-200"
                : "flex flex-col items-center justify-center text-on-surface-variant flex-1 h-full hover:bg-surface-container-low transition-colors active:scale-90 duration-200"
            }
          >
            <span
              className="material-symbols-outlined mb-1"
              style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}
            >
              {item.icon}
            </span>
            <span className="font-label-sm text-label-sm">{t(item.label)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
