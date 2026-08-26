"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { translate, type Lang } from "@/lib/i18n/translations";

const ITEMS = [
  { href: "/admin", label: "adminNavDashboard", icon: "space_dashboard" },
  { href: "/admin/notifications", label: "adminNavNotifications", icon: "notifications" },
  { href: "/admin/support", label: "adminNavSupport", icon: "support_agent" },
  { href: "/admin/analytics", label: "adminNavAnalytics", icon: "monitoring" },
  { href: "/admin/settings", label: "adminNavSettings", icon: "settings" },
] as const;

export function AdminSidebar({ lang }: { lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  const pathname = usePathname();

  return (
    <nav className="hidden md:flex flex-col fixed top-16 left-0 bottom-0 w-60 bg-primary text-on-primary px-3 py-4 gap-1 z-30 overflow-y-auto">
      {ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={
              active
                ? "flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/15 font-label-md text-label-md font-semibold transition-colors"
                : "flex items-center gap-3 px-3 py-2.5 rounded-lg text-on-primary/80 hover:bg-white/10 font-label-md text-label-md transition-colors"
            }
          >
            <span className="material-symbols-outlined">{item.icon}</span>
            {t(item.label)}
          </Link>
        );
      })}
    </nav>
  );
}
