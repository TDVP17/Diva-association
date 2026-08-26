"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { translate, type Lang } from "@/lib/i18n/translations";

export interface TopRightMenuItem {
  href: string;
  label: string;
  icon: string;
  badge?: number;
}

export function TopRightMenu({
  lang,
  items,
  onLogout,
}: {
  lang: Lang;
  items: TopRightMenuItem[];
  onLogout: () => Promise<void>;
}) {
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={t("openMenu")}
        aria-expanded={open}
        className="relative w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-container-low transition-colors"
      >
        <span className="material-symbols-outlined text-on-surface">menu</span>
      </button>

      {open && (
        <div className="absolute right-0 top-12 z-50 w-64 bg-white rounded-xl shadow-lg border border-outline-variant overflow-hidden">
          <div className="flex flex-col py-1">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-container-low transition-colors"
              >
                <span className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-on-surface-variant text-[20px]">{item.icon}</span>
                  <span className="font-label-md text-label-md text-on-surface">{item.label}</span>
                </span>
                {!!item.badge && (
                  <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-error text-on-error font-label-sm text-label-sm">
                    {item.badge}
                  </span>
                )}
              </Link>
            ))}
          </div>
          <form
            action={async () => {
              setOpen(false);
              await onLogout();
            }}
            className="border-t border-outline-variant"
          >
            <button
              type="submit"
              className="w-full flex items-center gap-3 px-4 py-3 text-error hover:bg-error/5 transition-colors"
            >
              <span className="material-symbols-outlined text-[20px]">logout</span>
              <span className="font-label-md text-label-md">{t("signOut")}</span>
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
