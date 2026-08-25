"use client";

import { useState } from "react";
import { translate, type Lang } from "@/lib/i18n/translations";

interface UnpaidSlot {
  id: string;
  beneficiaryName: string;
}

export function PublicPayForm({
  initialUnpaidSlots,
  lang,
}: {
  initialUnpaidSlots: UnpaidSlot[];
  lang: Lang;
}) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const [slots] = useState(initialUnpaidSlots);
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePay() {
    if (!selectedSlotId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/payments/public/pay-slot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membershipSlotId: selectedSlotId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? t("paymentInitiationFailed"));
      window.location.href = body.paymentUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : t("paymentInitiationFailed"));
      setLoading(false);
    }
  }

  if (slots.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant p-5 text-center">
        <p className="font-body-md text-body-md text-on-surface-variant">
          {t("everyonePaidAlready")}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant p-5 flex flex-col gap-4">
      <div>
        <label htmlFor="slot" className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
          {t("whoAreYouPayingFor")}
        </label>
        <select
          id="slot"
          value={selectedSlotId}
          onChange={(e) => setSelectedSlotId(e.target.value)}
          className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md bg-white"
        >
          <option value="">{t("selectAName")}</option>
          {slots.map((s) => (
            <option key={s.id} value={s.id}>
              {s.beneficiaryName}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="font-label-sm text-label-sm text-error">{error}</p>}
      <button
        onClick={handlePay}
        disabled={!selectedSlotId || loading}
        className="w-full py-3 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 active:scale-95 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
      >
        <span className="material-symbols-outlined">payments</span>
        {loading ? t("redirectingToFapshi") : t("payViaFapshi")}
      </button>
    </div>
  );
}
