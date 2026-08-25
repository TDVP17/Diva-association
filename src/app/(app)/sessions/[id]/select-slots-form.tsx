"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { translate, type Lang } from "@/lib/i18n/translations";

const SLOT_OPTIONS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

export function SelectSlotsForm({ tontineSessionId, lang }: { tontineSessionId: string; lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const router = useRouter();
  const [slotCount, setSlotCount] = useState(1);
  const [names, setNames] = useState<string[]>([""]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const namedSlots = Math.floor(slotCount);

  function handleSlotCountChange(next: number) {
    setSlotCount(next);
    const nextNamed = Math.floor(next);
    setNames((current) => {
      const copy = current.slice(0, nextNamed);
      while (copy.length < nextNamed) copy.push("");
      return copy;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (names.some((n) => !n.trim())) {
      setError(t("fillAllNames"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${tontineSessionId}/slots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotCount, beneficiaryNames: names.map((n) => n.trim()) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? t("couldNotSaveSlots"));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("couldNotSaveSlots"));
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant p-4 flex flex-col gap-4 text-left"
    >
      <div>
        <label htmlFor="slotCount" className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
          {t("contributionSlots")}
        </label>
        <select
          id="slotCount"
          value={slotCount}
          onChange={(e) => handleSlotCountChange(Number(e.target.value))}
          className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md bg-white"
        >
          {SLOT_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt} {opt !== 1 ? t("slots") : t("slot")}
            </option>
          ))}
        </select>
        {slotCount % 1 !== 0 && (
          <p className="font-label-sm text-label-sm text-on-surface-variant mt-1">
            {namedSlots} {t("namedSlotsBillingNote")}
          </p>
        )}
      </div>

      {names.map((name, i) => (
        <div key={i}>
          <label className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
            {t("beneficiaryName")} — {t("slot")} {i + 1}
          </label>
          <input
            value={name}
            onChange={(e) =>
              setNames((current) => current.map((n, idx) => (idx === i ? e.target.value : n)))
            }
            className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
          />
        </div>
      ))}

      {error && <p className="font-label-sm text-label-sm text-error">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full py-3 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 active:scale-95 transition-all disabled:opacity-60"
      >
        {submitting ? t("saving") : t("confirmSlots")}
      </button>
    </form>
  );
}
