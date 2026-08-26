"use client";

import { useState } from "react";
import { translate, type Lang } from "@/lib/i18n/translations";

interface PayoutOrderRow {
  position: number | null;
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
        className="font-label-sm text-label-sm text-primary underline flex items-center gap-1"
      >
        <span className="material-symbols-outlined text-[16px]">format_list_numbered</span>
        {t("viewPayoutOrder")}
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
              <p className="font-label-sm text-label-sm text-on-surface-variant">…</p>
            ) : rows.length === 0 ? (
              <p className="font-label-sm text-label-sm text-on-surface-variant">{t("notYetRevealed")}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {rows.map((r, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-3 bg-surface-container-lowest rounded-lg"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-7 h-7 rounded-full bg-secondary-fixed-dim/30 text-on-secondary-fixed-variant flex items-center justify-center font-label-sm text-label-sm font-bold flex-shrink-0">
                        {r.position}
                      </div>
                      <div className="min-w-0">
                        <p className="font-label-md text-label-md text-on-surface truncate">{r.beneficiaryName}</p>
                        <p className="font-label-sm text-label-sm text-on-surface-variant truncate">{r.memberName}</p>
                      </div>
                    </div>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-md font-label-sm text-label-sm flex-shrink-0 ml-2 ${STATUS_CLASS[r.status]}`}
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
