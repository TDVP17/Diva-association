"use client";

import { useState } from "react";

export function PayButton({
  tontineSessionId,
  amountLabel,
}: {
  tontineSessionId: string;
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
        body: JSON.stringify({ tontineSessionId }),
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
    <div className="fixed bottom-24 md:bottom-6 left-0 right-0 px-container-padding z-40">
      <div className="max-w-3xl mx-auto">
        {error && (
          <p className="font-label-sm text-label-sm text-error text-center mb-2 bg-white rounded-lg py-2 shadow-sm">
            {error}
          </p>
        )}
        <button
          onClick={handlePay}
          disabled={loading}
          className="w-full bg-primary text-on-primary font-label-md text-label-md h-14 rounded-lg flex items-center justify-center gap-2 hover:opacity-90 active:scale-95 transition-all shadow-[0px_8px_30px_rgba(30,41,59,0.12)] disabled:opacity-60"
        >
          <span className="material-symbols-outlined">payments</span>
          {loading ? "Redirecting to Fapshi..." : `Pay ${amountLabel} via Fapshi`}
        </button>
      </div>
    </div>
  );
}
