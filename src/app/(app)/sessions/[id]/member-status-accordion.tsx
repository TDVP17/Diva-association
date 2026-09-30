"use client";

import { useState } from "react";
import { translate, type Lang } from "@/lib/i18n/translations";
import { formatXAF } from "@/lib/format-currency";

export interface MemberStatusSlotItem {
  id: string;
  beneficiaryName: string;
  ballDrawn: number | null;
  officialPosition: number | null;
  isMine: boolean;
  paid: boolean;
  paidAtLabel: string | null;
  paidByRelativeName?: string | null;
  fineAmount?: number | null;
  estimatedDateLabel?: string | null;
}

export function MemberStatusAccordion({
  slots,
  lang,
}: {
  slots: MemberStatusSlotItem[];
  lang: Lang;
}) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  // Comes closed by default as instructed
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="mb-stack-gap-lg bg-surface rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-4 flex items-center justify-between hover:bg-surface-container-low transition-colors cursor-pointer text-left"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-[22px]">groups</span>
          </div>
          <div>
            <h2 className="font-title-sm text-title-sm text-primary font-bold">
              {t("memberStatus")}
            </h2>
            <p className="font-label-sm text-xs text-on-surface-variant mt-0.5">
              {isOpen
                ? lang === "fr"
                  ? "Cliquez pour refermer"
                  : "Click to close"
                : lang === "fr"
                ? `Cliquez pour voir les membres (${slots.length} part${slots.length > 1 ? "s" : ""})`
                : `Click to view members (${slots.length} slot${slots.length > 1 ? "s" : ""})`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-on-surface-variant">
          <span className="font-label-sm text-xs hidden sm:inline">
            {isOpen ? (lang === "fr" ? "Fermer" : "Close") : (lang === "fr" ? "Ouvrir" : "Open")}
          </span>
          <span
            className={`material-symbols-outlined text-2xl transition-transform duration-200 ${
              isOpen ? "rotate-180" : ""
            }`}
          >
            expand_more
          </span>
        </div>
      </button>

      {isOpen && (
        <div className="border-t border-surface-variant animate-in fade-in duration-200 divide-y divide-surface-variant">
          {slots.map((s) => (
            <div
              key={s.id}
              className={`flex items-center p-4 ${s.isMine ? "bg-primary/5" : ""}`}
            >
              <div className="flex-shrink-0 mr-2">
                {s.paid ? (
                  <span className="material-symbols-outlined text-[#059669] text-xl font-bold" title={t("paid")}>
                    check_circle
                  </span>
                ) : (
                  <span className="material-symbols-outlined text-slate-300 text-xl" title={t("notYetPaid")}>
                    radio_button_unchecked
                  </span>
                )}
              </div>
              <div className="font-label-md text-label-md text-on-surface-variant w-7 text-center mr-2">
                {s.ballDrawn ?? "—"}
              </div>
              <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-label-md text-label-md font-bold mr-3 overflow-hidden flex-shrink-0 border border-primary/20">
                {s.beneficiaryName.slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-grow min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-label-md text-label-md text-on-surface truncate font-semibold">
                    {s.beneficiaryName}
                  </span>
                  {s.isMine && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-primary/10 text-primary">
                      {lang === "fr" ? "Votre part" : "Your slot"}
                    </span>
                  )}
                  {s.paid && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#d1fae5] text-[#065f46]">
                      {t("paid")}
                    </span>
                  )}
                </div>
                <div className="font-label-sm text-label-sm text-on-surface-variant truncate">
                  {s.paid
                    ? ` · ${s.paidAtLabel ? t("paidAtLabel", { time: s.paidAtLabel }) : t("paid")}`
                    : ` · ${t("notYetPaid")}`}
                  {s.paidByRelativeName && (
                    <span className="text-primary font-medium">
                      {" "}· {t("paidByRelativeBadge", { name: s.paidByRelativeName })}
                    </span>
                  )}
                </div>
                <div className="font-label-sm text-[11px] text-on-surface-variant truncate">
                  {s.estimatedDateLabel
                    ? `${t("estimatedDateLabel")}: ${s.estimatedDateLabel}`
                    : t("positionNotYetAssignedShort")}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <span
                  className={
                    s.paid
                      ? "inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#d1fae5] text-[#065f46] font-label-sm text-label-sm font-semibold"
                      : s.fineAmount
                      ? "inline-flex items-center px-2 py-1 rounded-md bg-error-container text-on-error-container font-label-sm text-label-sm"
                      : "inline-flex items-center px-2 py-1 rounded-md bg-secondary-fixed text-on-secondary-fixed-variant font-label-sm text-label-sm"
                  }
                >
                  {s.paid ? (
                    <>
                      <span className="material-symbols-outlined text-[14px]">check</span>
                      {t("paid")}
                    </>
                  ) : s.fineAmount ? (
                    t("late")
                  ) : (
                    t("notYetPaid")
                  )}
                </span>
                {s.fineAmount && s.fineAmount > 0 && (
                  <div className="font-label-sm text-label-sm text-error mt-1">
                    +{formatXAF(s.fineAmount)} {t("fineSuffix")}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
