"use client";

import { useState } from "react";
import { PaymentConfirmDialog } from "@/components/payment-confirm-dialog";
import { translate, type Lang } from "@/lib/i18n/translations";
import { parseJsonOrThrow, friendlyErrorMessage } from "@/lib/api-error";

export function PayButton({
  membershipSlotId,
  amountLabel,
  lang,
  lockedReason,
}: {
  membershipSlotId: string;
  amountLabel: string;
  lang: Lang;
  /** Set when the round-robin lock blocks this cycle — disables the button up front instead of erroring after a tap. */
  lockedReason?: string;
}) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/payments/fapshi/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membershipSlotId }),
      });
      const body = await parseJsonOrThrow<{ paymentUrl: string }>(res, t("paymentInitiationFailed"));
      window.location.href = body.paymentUrl;
    } catch (err) {
      setError(friendlyErrorMessage(err, t("paymentInitiationFailed")));
      setLoading(false);
      setShowConfirm(false);
    }
  }

  if (lockedReason) {
    return (
      <div className="flex flex-col items-end gap-1 max-w-[160px]">
        <button
          disabled
          className="px-3 py-1.5 rounded-lg bg-surface-variant text-on-surface-variant font-label-sm text-label-sm flex items-center gap-1 opacity-60 cursor-not-allowed"
        >
          <span className="material-symbols-outlined text-[16px]">lock</span>
          {t("payAmountButton", { amount: amountLabel })}
        </button>
        <p className="font-label-sm text-[11px] text-on-surface-variant text-right">{lockedReason}</p>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => setShowConfirm(true)}
        disabled={loading}
        className="px-3 py-1.5 rounded-lg bg-primary text-on-primary font-label-sm text-label-sm flex items-center gap-1 hover:opacity-90 active:scale-95 transition-all disabled:opacity-60"
      >
        <span className="material-symbols-outlined text-[16px]">payments</span>
        {loading ? t("redirectingToFapshi") : t("payAmountButton", { amount: amountLabel })}
      </button>
      {error && <p className="font-label-sm text-label-sm text-error mt-1">{error}</p>}
      {showConfirm && (
        <PaymentConfirmDialog
          lang={lang}
          membershipSlotId={membershipSlotId}
          onConfirm={handleConfirm}
          onClose={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
}
