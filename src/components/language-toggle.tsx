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

  const inactiveClass = dark
    ? "px-3 py-1 rounded-full font-label-sm text-label-sm text-on-primary/70 hover:bg-white/10"
    : "px-3 py-1 rounded-full font-label-sm text-label-sm text-on-surface-variant hover:bg-surface-container-low";
  const activeClass = dark
    ? "px-3 py-1 rounded-full font-label-sm text-label-sm bg-white/20 text-on-primary"
    : "px-3 py-1 rounded-full font-label-sm text-label-sm bg-primary text-on-primary";

  return (
    <div className={`flex gap-1 ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => handleChange("en")}
        disabled={pending}
        className={currentLang === "en" ? activeClass : inactiveClass}
      >
        EN
      </button>
      <button
        type="button"
        onClick={() => handleChange("fr")}
        disabled={pending}
        className={currentLang === "fr" ? activeClass : inactiveClass}
      >
        FR
      </button>
    </div>
  );
}
