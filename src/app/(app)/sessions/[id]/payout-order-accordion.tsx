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
            className={`material-symbols-outlined text-2xl transition-transform duration-200 ${
              isOpen ? "rotate-180" : ""
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
          ) : !rows || rows.length === 0 ? (
            <div className="p-4 text-center text-xs text-on-surface-variant bg-surface-container-low rounded-lg">
              {t("notYetRevealed")}
            </div>
          ) : (
            <div className="flex flex-col gap-2 mt-2">
              {rows.map((r, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-3 bg-surface-container-lowest rounded-lg border border-surface-variant/40"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-label-md text-xs font-bold flex-shrink-0">
                      {r.position ?? "—"}
                    </div>
                    <div className="min-w-0">
                      <p className="font-label-md text-sm text-on-surface truncate font-semibold">
                        {r.beneficiaryName}
                      </p>
                      {r.estimatedDate && (
                        <p className="font-label-sm text-xs text-on-surface-variant truncate">
                          {new Date(r.estimatedDate).toLocaleDateString(
                            lang === "fr" ? "fr-FR" : "en-US",
                            { day: "numeric", month: "long", year: "numeric" },
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-md font-label-sm text-xs flex-shrink-0 ml-2 font-medium ${
                      STATUS_CLASS[r.status]
                    }`}
                  >
                    {r.status === "CONFIRMED"
                      ? t(STATUS_KEY[r.status], {
                          date: r.memberConfirmedAt
                            ? new Date(r.memberConfirmedAt).toLocaleDateString("en-US", {
                                day: "numeric",
                                month: "short",
                              })
                            : "",
                        })
                      : t(STATUS_KEY[r.status])}
                    {r.status === "CONFIRMED" && r.confirmedByAdmin && ` ${t("confirmedByAdminLabel")}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
