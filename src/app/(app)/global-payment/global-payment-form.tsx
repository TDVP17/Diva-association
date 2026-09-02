"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { translate, type Lang } from "@/lib/i18n/translations";
import { formatXAF } from "@/lib/format-currency";
import { BulkPaymentDialog } from "./bulk-payment-dialog";
import type { UnpaidSlotSummary } from "@/lib/initiate-bulk-payment";

export function GlobalPaymentForm({
  slots,
  defaultPhone,
  lang,
}: {
  slots: UnpaidSlotSummary[];
  defaultPhone: string | null;
  lang: Lang;
}) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const router = useRouter();
  const payable = slots.filter((s) => !s.locked);
  const [selected, setSelected] = useState<Set<string>>(new Set(payable.map((s) => s.membershipSlotId)));
  const [showConfirm, setShowConfirm] = useState(false);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === payable.length ? new Set() : new Set(payable.map((s) => s.membershipSlotId)),
    );
  }

  const selectedItems = payable.filter((s) => selected.has(s.membershipSlotId));
  const combinedTotal = selectedItems.reduce((sum, s) => sum + s.baseTotal, 0);

  return (
    <div className="flex flex-col gap-stack-gap-md pb-28">
      {payable.length > 0 && (
        <button
          onClick={toggleAll}
          className="self-start font-label-sm text-label-sm text-primary hover:underline"
        >
          {selected.size === payable.length ? t("globalPaymentDeselectAll") : t("globalPaymentSelectAll")}
        </button>
      )}

      <div className="bg-surface rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant overflow-hidden">
        {slots.map((s, index) => (
          <label
            key={s.membershipSlotId}
            className={`flex items-center gap-3 p-4 ${index < slots.length - 1 ? "border-b border-surface-variant" : ""} ${
              s.locked ? "opacity-60" : "cursor-pointer hover:bg-surface-container-low"
            }`}
          >
            <input
              type="checkbox"
              checked={selected.has(s.membershipSlotId)}
              disabled={s.locked}
              onChange={() => toggle(s.membershipSlotId)}
              className="w-5 h-5 accent-primary flex-shrink-0"
            />
            <div className="flex-grow min-w-0">
              <div className="font-label-md text-label-md text-on-surface truncate">{s.beneficiaryName}</div>
              <div className="font-label-sm text-label-sm text-on-surface-variant truncate">{s.sessionLabel}</div>
              {s.locked && s.lockedReason && (
                <div className="font-label-sm text-[11px] text-error mt-0.5">{s.lockedReason}</div>
              )}
            </div>
            <div className="flex flex-col items-end flex-shrink-0">
              {s.locked && (
                <span className="font-label-sm text-[10px] uppercase tracking-wide text-error mb-0.5">
                  {t("globalPaymentLockedBadge")}
                </span>
              )}
              <span className="font-numeric-data text-numeric-data text-on-surface">{formatXAF(s.baseTotal)}</span>
            </div>
          </label>
        ))}
      </div>

      <div className="fixed bottom-20 md:bottom-4 left-0 right-0 md:left-60 px-container-padding">
        <div className="max-w-3xl lg:max-w-6xl mx-auto bg-surface rounded-xl shadow-xl border border-surface-variant p-4 flex items-center justify-between gap-3">
          <div>
            <div className="font-label-sm text-label-sm text-on-surface-variant">
              {t("globalPaymentSelectedCount", { count: String(selectedItems.length) })}
            </div>
            <div className="font-headline-sm text-headline-sm text-primary">{formatXAF(combinedTotal)}</div>
          </div>
          <button
            onClick={() => setShowConfirm(true)}
            disabled={selectedItems.length === 0}
            className="px-4 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 active:scale-95 transition-all disabled:opacity-50"
          >
            {t("globalPaymentPayButton", { amount: formatXAF(combinedTotal) })}
          </button>
        </div>
      </div>

      {showConfirm && (
        <BulkPaymentDialog
          lang={lang}
          membershipSlotIds={selectedItems.map((s) => s.membershipSlotId)}
          defaultPhone={defaultPhone}
          onSettled={() => router.refresh()}
          onClose={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
}
