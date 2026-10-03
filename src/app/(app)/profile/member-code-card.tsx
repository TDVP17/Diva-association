"use client";

import { useState } from "react";
import { translate, type Lang } from "@/lib/i18n/translations";

/**
 * A member's unique, permanent identifier — this is what relatives/friends
 * use on the "Contribute for a Relative" flow to find them and pay on their
 * behalf, so it needs to be trivially easy to copy and hand over.
 *
 * Sharing creates a direct link to `/pay?code=DIVA0001` so the recipient
 * can click through, see only the member's unpaid cotisations, and pay
 * immediately — no manual code entry needed.
 */
export function MemberCodeCard({ code, lang }: { code: string | null; lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const [copied, setCopied] = useState(false);

  if (!code) return null;

  function getShareUrl() {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/pay?code=${encodeURIComponent(code!)}`;
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(getShareUrl());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — silently ignore, the code is still visible to copy manually.
    }
  }

  async function shareCode() {
    if (!code) return;
    const shareUrl = getShareUrl();
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: "DIVA Asso",
          text: t("shareCodeMessage"),
          url: shareUrl,
        });
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") {
          await copyCode();
        }
      }
    } else {
      await copyCode();
    }
  }

  return (
    <div className="w-full bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant p-4 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="font-label-sm text-label-sm text-on-surface-variant">{t("myPersonalCode")}</p>
        <p className="font-numeric-data text-[18px] text-primary tracking-wide truncate">{code}</p>
        <p className="font-label-sm text-label-sm text-on-surface-variant mt-1">{t("myPersonalCodeHelper")}</p>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button
          type="button"
          onClick={copyCode}
          className="px-3 py-2 rounded-lg border border-outline-variant text-on-surface font-label-sm text-label-sm hover:bg-surface flex items-center gap-1 transition-colors"
        >
          <span className="material-symbols-outlined text-[16px]">{copied ? "check" : "content_copy"}</span>
          {copied ? t("copied") : t("copy")}
        </button>
        <button
          type="button"
          onClick={shareCode}
          aria-label={t("share")}
          title={t("share")}
          className="px-2.5 py-2 rounded-lg border border-outline-variant text-on-surface font-label-sm text-label-sm hover:bg-surface flex items-center justify-center transition-colors"
        >
          <span className="material-symbols-outlined text-[18px]">share</span>
        </button>
      </div>
    </div>
  );
}
