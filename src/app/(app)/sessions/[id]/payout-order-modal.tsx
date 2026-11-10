"use client";

import { useState } from "react";
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

export function PayoutOrderModal({ tontineSessionId, lang }: { tontineSessionId: string; lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<PayoutOrderRow[] | null>(null);

  async function openModal() {
    setOpen(true);
    const res = await fetch(`/api/sessions/${tontineSessionId}/payout-order`);
    if (res.ok) {
      const body = await res.json();
      setRows(body.rows);
    }
  }

  return (
    <>
      <button
        onClick={openModal}
        className="font-label-sm text-label-sm text-primary underline flex items-center gap-1.5"
      >
        <span className="material-symbols-outlined text-[18px] leading-none flex-shrink-0">format_list_numbered</span>
        <span className="leading-none">{t("viewPayoutOrder")}</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-container-padding bg-black/50"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm max-h-[80vh] overflow-y-auto bg-white rounded-2xl p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-title-md text-title-md text-on-surface mb-stack-gap-md">{t("payoutOrderTitle")}</h2>

            {!rows ? (
              <LoadingSpinner className="py-6" />
            ) : rows.length === 0 ? (
              <p className="font-label-sm text-label-sm text-on-surface-variant">{t("notYetRevealed")}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {rows.map((r, i) => {
                  const isConfirmed = r.status === "CONFIRMED";
                  const isReleased = r.status === "RELEASED";
                  const isDetailsSubmitted = r.status === "DETAILS_SUBMITTED";

                  return (
                    <div
                      key={i}
                      className={`flex items-center justify-between p-3 rounded-xl border transition-colors gap-3 ${
                        isConfirmed
                          ? "bg-emerald-50/40 border-emerald-200 shadow-2xs"
                          : "bg-surface-container-lowest border-surface-variant/40"
                      }`}
                    >
                      {/* Left: Position circle + Beneficiary name + Date */}
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                            isConfirmed
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

            <button
              onClick={() => setOpen(false)}
              className="w-full mt-4 py-2 rounded-lg border border-outline-variant text-on-surface-variant font-label-md text-label-md hover:bg-surface-container-low"
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
