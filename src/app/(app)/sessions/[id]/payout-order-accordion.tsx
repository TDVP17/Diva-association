"use client";

import { useState } from "react";
import Link from "next/link";
import { translate, type Lang } from "@/lib/i18n/translations";
import { LoadingSpinner } from "@/components/loading-spinner";

interface PayoutOrderRow {
  position: number | null;
  estimatedDate: string | null;
  beneficiaryName: string;
  memberName: string;
  status: "pending" | "DETAILS_SUBMITTED" | "RELEASED" | "CONFIRMED";
  confirmedByAdmin: boolean;
  releasedAt: string | null;
  memberConfirmedAt: string | null;
}

const STATUS_KEY: Record<PayoutOrderRow["status"], Parameters<typeof translate>[1]> = {
  pending: "payoutStatusPending",
  DETAILS_SUBMITTED: "payoutStatusDetailsSubmitted",
  RELEASED: "payoutStatusReleased",
  CONFIRMED: "payoutStatusConfirmed",
};

const STATUS_CLASS: Record<PayoutOrderRow["status"], string> = {
  pending: "bg-secondary-fixed text-on-secondary-fixed-variant",
  DETAILS_SUBMITTED: "bg-secondary-container/40 text-on-secondary-container",
  RELEASED: "bg-secondary-container/40 text-on-secondary-container",
  CONFIRMED: "bg-[#d1fae5] text-[#065f46]",
};

export function PayoutOrderAccordion({
  tontineSessionId,
  lang,
}: {
  tontineSessionId: string;
  lang: Lang;
}) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  // Comes closed by default as instructed
  const [isOpen, setIsOpen] = useState(false);
  const [rows, setRows] = useState<PayoutOrderRow[] | null>(null);
  const [userMustDrawFirst, setUserMustDrawFirst] = useState(false);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    const next = !isOpen;
    setIsOpen(next);
    if (next && rows === null && !loading) {
      setLoading(true);
      try {
        const res = await fetch(`/api/sessions/${tontineSessionId}/payout-order`);
        if (res.ok) {
          const body = await res.json();
          setRows(body.rows);
          if (body.userMustDrawFirst) {
            setUserMustDrawFirst(true);
          }
        }
      } catch (err) {
        console.warn("[PayoutOrderAccordion] fetch error:", err);
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <div className="mb-stack-gap-lg bg-surface rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        className="w-full p-4 flex items-center justify-between hover:bg-surface-container-low transition-colors cursor-pointer text-left"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-[22px]">format_list_numbered</span>
          </div>
          <div>
            <h2 className="font-title-sm text-title-sm text-primary font-bold">
              {t("payoutOrderTitle")}
            </h2>
            <p className="font-label-sm text-xs text-on-surface-variant mt-0.5">
              {isOpen
                ? lang === "fr"
                  ? "Cliquez pour refermer"
                  : "Click to close"
                : lang === "fr"
                  ? "Cliquez pour voir l'ordre de passage"
                  : "Click to view payout schedule"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-on-surface-variant">
          <span className="font-label-sm text-xs hidden sm:inline">
            {isOpen ? (lang === "fr" ? "Fermer" : "Close") : (lang === "fr" ? "Ouvrir" : "Open")}
          </span>
          <span
            className={`material-symbols-outlined text-2xl transition-transform duration-200 ${isOpen ? "rotate-180" : ""
              }`}
          >
            expand_more
          </span>
        </div>
      </button>

      {isOpen && (
        <div className="p-4 pt-1 border-t border-surface-variant animate-in fade-in duration-200">
          {loading ? (
            <div className="py-6 flex justify-center">
              <LoadingSpinner className="py-4" />
            </div>
          ) : userMustDrawFirst ? (
            <div className="p-4 text-center text-xs text-on-surface-variant bg-surface-container-low rounded-lg flex flex-col items-center gap-2">
              <span className="material-symbols-outlined text-emerald-700 text-2xl">casino</span>
              <p className="font-medium text-slate-800">
                {lang === "fr"
                  ? "Vous devez d'abord tirer votre boule chanceuse pour découvrir l'ordre de passage !"
                  : "You must pick your lucky ball first to reveal the payout schedule!"}
              </p>
              <Link
                href={`/sessions/${tontineSessionId}/draw`}
                className="mt-1 px-3 py-1.5 rounded-lg bg-emerald-700 text-white font-bold text-xs hover:bg-emerald-800 transition-colors shadow-xs"
              >
                {lang === "fr" ? "Tirer ma boule chanceuse" : "Draw my lucky ball"}
              </Link>
            </div>
          ) : !rows || rows.length === 0 ? (
            <div className="p-4 text-center text-xs text-on-surface-variant bg-surface-container-low rounded-lg">
              {t("notYetRevealed")}
            </div>
          ) : (
            <div className="flex flex-col gap-2 mt-2">
              {rows.map((r, i) => {
                const isConfirmed = r.status === "CONFIRMED";
                const isReleased = r.status === "RELEASED";
                const isDetailsSubmitted = r.status === "DETAILS_SUBMITTED";

                return (
                  <div
                    key={i}
                    className={`flex items-center justify-between p-3 rounded-xl border transition-colors gap-3 ${isConfirmed
                        ? "bg-emerald-50/40 border-emerald-200 shadow-2xs"
                        : "bg-surface-container-lowest border-surface-variant/40"
                      }`}
                  >
                    {/* Left: Position circle + Beneficiary name + Date */}
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${isConfirmed
                            ? "bg-emerald-700 text-white shadow-2xs"
                            : "bg-primary/10 text-primary"
                          }`}
                      >
                        {r.position ?? "—"}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-sm text-slate-900 truncate leading-snug">
                          {r.beneficiaryName}
                        </p>
                        {r.estimatedDate && (
                          <p className="text-xs text-slate-500 truncate mt-0.5">
                            {new Date(r.estimatedDate).toLocaleDateString(
                              lang === "fr" ? "fr-FR" : "en-US",
                              { day: "numeric", month: "long", year: "numeric" },
                            )}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Right: Clean, compact status message */}
                    {isConfirmed ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 shrink-0 shadow-2xs">
                        <span className="material-symbols-outlined text-[15px] text-emerald-700">check_circle</span>
                        <span>{lang === "fr" ? "Reçu" : "Received"}</span>
                      </span>
                    ) : isReleased ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-sky-100 text-sky-800 border border-sky-300 shrink-0">
                        <span className="material-symbols-outlined text-[15px] text-sky-700">send</span>
                        <span>{lang === "fr" ? "Virement envoyé" : "Sent"}</span>
                      </span>
                    ) : isDetailsSubmitted ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300 shrink-0">
                        <span className="material-symbols-outlined text-[15px] text-amber-700">schedule</span>
                        <span>{lang === "fr" ? "En attente" : "Pending"}</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200/80 shrink-0">
                        <span>{lang === "fr" ? "Pas encore dû" : "Not yet due"}</span>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
