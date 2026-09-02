"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { translate, type Lang } from "@/lib/i18n/translations";

export function HideClosedSessionButton({ membershipId, lang }: { membershipId: string; lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleHide(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(t("confirmHideClosedSession"))) return;
    setBusy(true);
    try {
      await fetch(`/api/memberships/${membershipId}/hide`, { method: "POST" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleHide}
      disabled={busy}
      aria-label={t("hideClosedSession")}
      title={t("hideClosedSession")}
      className="flex-shrink-0 w-11 h-11 flex items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-low hover:text-error transition-colors disabled:opacity-50"
    >
      <span className="material-symbols-outlined text-[20px]">visibility_off</span>
    </button>
  );
}
