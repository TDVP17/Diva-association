"use client";

import { useState } from "react";
import { translate, type Lang } from "@/lib/i18n/translations";

export function MemberCodeCard({ code, lang }: { code: string | null; lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const [copied, setCopied] = useState(false);

  if (!code) return null;

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code!);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — silently ignore, the code is still visible to copy manually.
    }
  }

  return (
    <div className="w-full bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant p-4 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="font-label-sm text-label-sm text-on-surface-variant">{t("myPersonalCode")}</p>
        <p className="font-numeric-data text-[18px] text-primary tracking-wide truncate">{code}</p>
        <p className="font-label-sm text-label-sm text-on-surface-variant mt-1">{t("myPersonalCodeHelper")}</p>
      </div>
      <button
        onClick={copyCode}
        className="flex-shrink-0 px-3 py-2 rounded-lg border border-outline-variant text-on-surface font-label-sm text-label-sm hover:bg-surface flex items-center gap-1"
      >
        <span className="material-symbols-outlined text-[16px]">{copied ? "check" : "content_copy"}</span>
        {copied ? t("copied") : t("copy")}
      </button>
    </div>
  );
}
