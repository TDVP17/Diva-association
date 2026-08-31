"use client";

import { useState } from "react";
import { PaymentConfirmDialog } from "@/components/payment-confirm-dialog";
import { translate, type Lang } from "@/lib/i18n/translations";
import { parseJsonOrThrow, friendlyErrorMessage } from "@/lib/api-error";

export function FinePayButton({ fineId, lang }: { fineId: string; lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/fines/${fineId}/pay`, { method: "POST" });
      const body = await parseJsonOrThrow<{ paymentUrl: string }>(res, "Payment initiation failed");
      window.location.href = body.paymentUrl;
    } catch (err) {
      setError(friendlyErrorMessage(err, "Payment initiation failed"));
      setLoading(false);
      setShowConfirm(false);
    }
  }

  return (
    <div>
      <button
        onClick={() => setShowConfirm(true)}
        disabled={loading}
        className="px-3 py-1.5 rounded-lg bg-error text-on-error font-label-sm text-label-sm flex items-center gap-1 hover:opacity-90 active:scale-95 transition-all disabled:opacity-60"
      >
        <span className="material-symbols-outlined text-[16px]">payments</span>
        {loading ? t("redirectingToFapshi") : t("payThisFine")}
      </button>
      {error && <p className="font-label-sm text-label-sm text-error mt-1">{error}</p>}
      {showConfirm && (
        <PaymentConfirmDialog
          lang={lang}
          fineId={fineId}
          onConfirm={handleConfirm}
          onClose={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
}
