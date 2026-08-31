"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { translate, type Lang } from "@/lib/i18n/translations";
import { parseJsonOrThrow, friendlyErrorMessage } from "@/lib/api-error";

const SLOT_OPTIONS = [1, 2, 3, 4, 5];

export function SelectSlotsForm({ tontineSessionId, lang }: { tontineSessionId: string; lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const router = useRouter();
  const [slotCount, setSlotCount] = useState(1);
  const [names, setNames] = useState<string[]>([""]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adjustedNotice, setAdjustedNotice] = useState<string | null>(null);

  function handleSlotCountChange(next: number) {
    setSlotCount(next);
    setNames((current) => {
      const copy = current.slice(0, next);
      while (copy.length < next) copy.push("");
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
      const trimmedNames = names.map((n) => n.trim());
      const res = await fetch(`/api/sessions/${tontineSessionId}/slots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotCount, beneficiaryNames: trimmedNames }),
      });
      const body = await parseJsonOrThrow<{ beneficiaryNames?: string[] }>(res, t("couldNotSaveSlots"));

      const finalNames: string[] = body.beneficiaryNames ?? trimmedNames;
      const changes = trimmedNames
        .map((original, i) => (original !== finalNames[i] ? `${original} → ${finalNames[i]}` : null))
        .filter((s): s is string => s !== null);
      if (changes.length > 0) {
        setAdjustedNotice(t("namesAdjustedForUniqueness", { changes: changes.join(", ") }));
        setSubmitting(false);
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(friendlyErrorMessage(err, t("couldNotSaveSlots")));
      setSubmitting(false);
    }
  }

  if (adjustedNotice) {
    return (
      <div className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant p-4 flex flex-col gap-4 text-left">
        <p className="font-label-sm text-label-sm text-on-surface-variant">{adjustedNotice}</p>
        <button
          onClick={() => router.refresh()}
          className="w-full py-3 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 active:scale-95 transition-all"
        >
          {t("confirmSlots")}
        </button>
      </div>
    );
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
