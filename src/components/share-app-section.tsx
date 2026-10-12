"use client";

import { useState } from "react";
import { type Lang } from "@/lib/i18n/translations";
import { playUiTapSound } from "@/lib/sound-effects";

export function ShareAppSection({
  lang,
  variant = "card",
}: {
  lang: Lang;
  variant?: "card" | "menuItem";
}) {
  const [copied, setCopied] = useState(false);

  const shareUrl = typeof window !== "undefined" ? window.location.origin : "https://diva-association.vercel.app";
  const shareTitle = "DIVA Asso — Application de Cotisations";
  const shareText =
    lang === "fr"
      ? `Rejoignez DIVA Asso pour gérer et suivre vos cotisations et tontines en toute sécurité : ${shareUrl}`
      : `Join DIVA Asso to securely manage and participate in cotisations and tontines: ${shareUrl}`;

  async function handleShare() {
    playUiTapSound();
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: shareTitle,
          text: shareText,
          url: shareUrl,
        });
        return;
      } catch (err) {
        // User cancelled share or failed, proceed to fallback
        if ((err as Error).name === "AbortError") return;
      }
    }
    // Direct WhatsApp fallback
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`, "_blank");
  }

  async function handleCopyLink() {
    playUiTapSound();
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback
    }
  }

  if (variant === "menuItem") {
    return (
      <button
        type="button"
        onClick={handleShare}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-container-low transition-colors text-left cursor-pointer"
      >
        <span className="material-symbols-outlined text-[#25D366] text-[20px]">share</span>
        <span className="font-label-md text-label-md text-on-surface">
          {lang === "fr" ? "Partager l'application" : "Share the App"}
        </span>
      </button>
    );
  }

  return (
    <div className="w-full mt-4 bg-gradient-to-br from-emerald-50/80 via-white to-teal-50/60 rounded-2xl border border-emerald-200/80 p-4 shadow-sm flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center flex-shrink-0 shadow-2xs">
          <span className="material-symbols-outlined text-2xl">share</span>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-sm sm:text-base text-slate-900 leading-snug">
            {lang === "fr" ? "Partager l'application DIVA" : "Share the DIVA App"}
          </h3>
          <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
            {lang === "fr"
              ? "Invitez vos proches ou membres de famille à rejoindre l'application via WhatsApp, SMS ou les réseaux sociaux."
              : "Invite your relatives or family members to join the app via WhatsApp, SMS, or social networks."}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-emerald-100">
        <button
          type="button"
          onClick={handleShare}
          className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-[#25D366] hover:bg-[#20ba59] text-white font-bold text-xs shadow-xs transition-transform active:scale-95 cursor-pointer"
        >
          <span className="material-symbols-outlined text-[16px]">chat</span>
          <span>{lang === "fr" ? "Partager sur WhatsApp" : "Share on WhatsApp"}</span>
        </button>

        <button
          type="button"
          onClick={handleCopyLink}
          className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs border border-slate-200 transition-colors shadow-2xs cursor-pointer"
        >
          <span className="material-symbols-outlined text-[16px]">
            {copied ? "check" : "content_copy"}
          </span>
          <span>{copied ? (lang === "fr" ? "Lien copié !" : "Link copied!") : (lang === "fr" ? "Copier le lien" : "Copy link")}</span>
        </button>
      </div>
    </div>
  );
}
