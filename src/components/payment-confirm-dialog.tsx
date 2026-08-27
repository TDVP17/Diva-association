"use client";

import { useEffect, useState } from "react";
import { translate, type Lang, type TranslationKey } from "@/lib/i18n/translations";
import { parseJsonOrThrow, friendlyErrorMessage } from "@/lib/api-error";

interface Quote {
  baseTotal: number;
  providerFeeAmount: number;
  totalCharged: number;
}

/**
 * Pre-redirect "Amount / Payment fee / Total" screen — the user must see
 * the final amount to be deducted before any redirect to the payment
 * gateway. Only ever shows the combined provider fee, never the internal
 * gateway/president split (that split isn't even returned by the quote API).
 */
export function PaymentConfirmDialog({
  lang,
  membershipSlotId,
  onConfirm,
  onClose,
}: {
  lang: Lang;
  membershipSlotId: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = (key: TranslationKey) => translate(lang, key);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/payments/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ membershipSlotId }),
    })
      .then(async (res) => {
        const body = await parseJsonOrThrow<Quote>(res, t("couldNotCalculateTotal"));
        if (!cancelled) setQuote(body);
      })
      .catch((err) => {
        if (!cancelled) setError(friendlyErrorMessage(err, t("couldNotCalculateTotal")));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membershipSlotId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-container-padding"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-headline-sm text-headline-sm text-on-surface mb-4">{t("confirmPaymentTitle")}</h2>

        {error && <p className="font-label-sm text-label-sm text-error mb-4">{error}</p>}

        {!error && !quote && (
          <p className="font-label-sm text-label-sm text-on-surface-variant mb-4">{t("calculatingTotalEllipsis")}</p>
        )}

        {quote && (
          <div className="flex flex-col gap-2 mb-6">
            <div className="flex justify-between items-center">
              <span className="font-body-md text-body-md text-on-surface-variant">{t("amountLabel")}</span>
              <span className="font-label-md text-label-md text-on-surface">
                {quote.baseTotal.toLocaleString("en-US")} F
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-body-md text-body-md text-on-surface-variant">{t("paymentFeeLabel")}</span>
              <span className="font-label-md text-label-md text-on-surface">
                {quote.providerFeeAmount.toLocaleString("en-US")} F
              </span>
            </div>
            <div className="flex justify-between items-center border-t border-outline-variant pt-2 mt-1">
              <span className="font-label-md text-label-md text-on-surface">{t("totalToBeDeductedLabel")}</span>
              <span className="font-headline-sm text-headline-sm text-primary">
                {quote.totalCharged.toLocaleString("en-US")} F
              </span>
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-3 py-2.5 rounded-lg border border-outline text-on-surface font-label-md text-label-md hover:bg-surface-variant/50 transition-colors"
          >
            {t("cancelAction")}
          </button>
          <button
            onClick={() => {
              setConfirming(true);
              onConfirm();
            }}
            disabled={!quote || confirming}
            className="flex-1 px-3 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 active:scale-95 transition-all disabled:opacity-60"
          >
            {t("confirmAndPay")}
          </button>
        </div>
      </div>
    </div>
  );
}
