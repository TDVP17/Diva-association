"use client";

import { useState } from "react";
import { translate, type Lang } from "@/lib/i18n/translations";

function CodeRow({
  label,
  value,
  helper,
  lang,
}: {
  label: string;
  value: string | null;
  helper?: string;
  lang: Lang;
}) {
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  const [copied, setCopied] = useState(false);

  async function copyCode() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — silently ignore, the code is still visible to copy manually.
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="font-label-sm text-label-sm text-on-surface-variant">{label}</p>
        <p className="font-numeric-data text-[18px] text-primary tracking-wide truncate">{value ?? t("notSet")}</p>
        {helper && <p className="font-label-sm text-label-sm text-on-surface-variant mt-1">{helper}</p>}
      </div>
      {value && (
        <button
          onClick={copyCode}
          className="flex-shrink-0 px-3 py-2 rounded-lg border border-outline-variant text-on-surface font-label-sm text-label-sm hover:bg-surface flex items-center gap-1"
        >
          <span className="material-symbols-outlined text-[16px]">{copied ? "check" : "content_copy"}</span>
          {copied ? t("copied") : t("copy")}
        </button>
      )}
    </div>
  );
}

/** Referral code on top, personal code underneath — both copyable in one card. */
export function MemberCodeCard({
  code,
  sponsorCode,
  lang,
}: {
  code: string | null;
  sponsorCode: string | null;
  lang: Lang;
}) {
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);

  return (
    <div className="w-full bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant px-4 divide-y divide-surface-variant">
      <CodeRow label={t("sponsorCodeLabel")} value={sponsorCode} lang={lang} />
      <CodeRow
        label={t("myPersonalCode")}
        value={code}
        helper={code ? t("myPersonalCodeHelper") : undefined}
        lang={lang}
      />
    </div>
  );
}
