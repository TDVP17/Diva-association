"use client";

import { useState } from "react";
import { PaymentConfirmDialog } from "@/components/payment-confirm-dialog";
import type { Lang } from "@/lib/i18n/translations";
import { parseJsonOrThrow, friendlyErrorMessage } from "@/lib/api-error";

export function PayButton({
  membershipSlotId,
  amountLabel,
  lang,
}: {
  membershipSlotId: string;
  amountLabel: string;
  lang: Lang;
}) {
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
        className="px-3 py-1.5 rounded-lg bg-primary text-on-primary font-label-sm text-label-sm flex items-center gap-1 hover:opacity-90 active:scale-95 transition-all disabled:opacity-60"
      >
        <span className="material-symbols-outlined text-[16px]">payments</span>
        {loading ? "Redirecting..." : `Pay ${amountLabel}`}
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
