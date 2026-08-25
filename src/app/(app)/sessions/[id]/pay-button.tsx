"use client";

import { useState } from "react";

export function PayButton({
  membershipSlotId,
  amountLabel,
}: {
  membershipSlotId: string;
  amountLabel: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePay() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/payments/fapshi/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membershipSlotId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Payment initiation failed");
      window.location.href = body.paymentUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment initiation failed");
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        onClick={handlePay}
        disabled={loading}
        className="px-3 py-1.5 rounded-lg bg-primary text-on-primary font-label-sm text-label-sm flex items-center gap-1 hover:opacity-90 active:scale-95 transition-all disabled:opacity-60"
      >
        <span className="material-symbols-outlined text-[16px]">payments</span>
        {loading ? "Redirecting..." : `Pay ${amountLabel}`}
      </button>
      {error && <p className="font-label-sm text-label-sm text-error mt-1">{error}</p>}
    </div>
  );
}
