"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { translate, type Lang } from "@/lib/i18n/translations";

const ITEMS = [
  { href: "/dashboard", label: "navHome", icon: "home" },
  { href: "/sessions", label: "contributionsNavItem", icon: "account_balance" },
  { href: "/fines", label: "finesNavItem", icon: "receipt_long" },
  { href: "/chat", label: "messages", icon: "chat_bubble" },
  { href: "/profile", label: "navProfile", icon: "person" },
] as const;

export function BottomNav({ lang }: { lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 w-full z-50 rounded-t-xl border-t border-outline-variant shadow-[0px_-4px_20px_rgba(30,41,59,0.05)] bg-surface flex justify-around items-center h-20 pb-safe px-4 md:hidden">
      {ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={
              active
                ? "flex flex-col items-center justify-center gap-1.5 text-primary font-bold w-1/5 h-full transition-colors active:scale-90 duration-200"
                : "flex flex-col items-center justify-center gap-1.5 text-on-surface-variant w-1/5 h-full hover:bg-surface-container-low transition-colors active:scale-90 duration-200"
            }
          >
            <span
              className="material-symbols-outlined"
              style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}
            >
              {item.icon}
            </span>
            <span className="font-label-sm text-label-sm leading-none whitespace-nowrap">{t(item.label)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
