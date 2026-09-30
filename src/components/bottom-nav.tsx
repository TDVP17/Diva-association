"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { translate, type Lang } from "@/lib/i18n/translations";

const ITEMS = [
  { href: "/dashboard", label: "navHome", icon: "home" },
  { href: "/sessions", label: "contributionsNavItem", icon: "account_balance" },
  { href: "/fines", label: "finesNavItem", icon: "receipt_long" },
  { href: "/profile", label: "navProfile", icon: "person" },
] as const;

export function BottomNav({ lang, badges }: { lang: Lang; badges?: Record<string, number> }) {
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 w-full z-50 rounded-t-xl border-t border-outline-variant shadow-[0px_-4px_20px_rgba(30,41,59,0.05)] bg-surface flex justify-around items-center h-20 pb-safe px-4 md:hidden">
      {ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const badgeCount = badges?.[item.href] ?? 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={
              active
                ? "flex flex-col items-center justify-center gap-1.5 text-primary font-bold w-1/4 h-full transition-colors active:scale-90 duration-200"
                : "flex flex-col items-center justify-center gap-1.5 text-on-surface-variant w-1/4 h-full hover:bg-surface-container-low transition-colors active:scale-90 duration-200"
            }
          >
            <span className="relative inline-flex items-center justify-center">
              <span
                className="material-symbols-outlined"
                style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}
              >
                {item.icon}
              </span>
              {badgeCount > 0 && (
                <span className={`absolute -top-1.5 -right-2.5 inline-flex items-center justify-center min-w-[17px] h-[17px] px-1 rounded-full text-white font-bold text-[10px] leading-none shadow-sm ring-2 ring-white ${item.href === "/sessions" ? "bg-primary" : "bg-red-600"}`}>
                  {badgeCount > 99 ? "99+" : badgeCount}
                </span>
              )}
            </span>
            <span className="font-label-sm text-label-sm leading-none whitespace-nowrap">{t(item.label)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
