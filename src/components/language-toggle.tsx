"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setLangAction } from "@/lib/i18n/set-lang-action";
import type { Lang } from "@/lib/i18n/translations";

export function LanguageToggle({
  currentLang,
  className,
  dark,
}: {
  currentLang: Lang;
  className?: string;
  /** Use on a dark/primary-colored background (e.g. the admin top bar). */
  dark?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleChange(next: Lang) {
    if (next === currentLang || pending) return;
    startTransition(async () => {
      await setLangAction(next);
      router.refresh();
    });
  }

  const baseClasses = dark
    ? "bg-white/10 hover:bg-white/20 text-white border-white/25"
    : "bg-surface-container-low hover:bg-surface-container text-on-surface border-outline-variant/70";

  return (
    <div className={`relative inline-flex items-center ${className ?? ""}`}>
      <select
        value={currentLang}
        onChange={(e) => handleChange(e.target.value as Lang)}
        disabled={pending}
        aria-label="Langue / Language"
        className={`appearance-none cursor-pointer text-xs font-black uppercase rounded-lg pl-2 pr-5 py-1 border transition-colors focus:outline-none focus:ring-1 focus:ring-primary ${baseClasses} ${
          pending ? "opacity-60" : ""
        }`}
      >
        <option value="fr" className="text-slate-900 bg-white">FR</option>
        <option value="en" className="text-slate-900 bg-white">EN</option>
      </select>
      <span
        className={`material-symbols-outlined text-[15px] pointer-events-none absolute right-1 ${
          dark ? "text-white/80" : "text-on-surface-variant"
        }`}
      >
        expand_more
      </span>
    </div>
  );
}
