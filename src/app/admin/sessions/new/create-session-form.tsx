"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TONTINE_CONFIG } from "@/lib/tontine-engine";
import { translate, type Lang } from "@/lib/i18n/translations";

const TONTINE_LABELS: Record<string, string> = {
  HEBDO_SUNDAY: "Weekly Tontine (Sunday)",
  MONTHLY_28: "Monthly Tontine (28th)",
  MONTHLY_25: "Monthly Tontine (25th)",
};

type TontineTypeKey = keyof typeof TONTINE_CONFIG;

export function CreateSessionForm({ lang }: { lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [type, setType] = useState<TontineTypeKey>("HEBDO_SUNDAY");
  const [amount, setAmount] = useState(String(TONTINE_CONFIG.HEBDO_SUNDAY.amount));
  const [fee, setFee] = useState(String(TONTINE_CONFIG.HEBDO_SUNDAY.fee));
  const [rules, setRules] = useState("");
  const [startDate, setStartDate] = useState("");
  const [limitTime, setLimitTime] = useState("18:31");
  const [maxSlots, setMaxSlots] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleTypeChange(next: TontineTypeKey) {
    setType(next);
    setAmount(String(TONTINE_CONFIG[next].amount));
    setFee(String(TONTINE_CONFIG[next].fee));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          type,
          amount: Number(amount),
          fee: Number(fee),
          rules: rules || undefined,
          startDate,
          limitTime,
          maxSlots: maxSlots ? Number(maxSlots) : undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? t("couldNotCreateCotisation"));
      router.push("/admin");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("couldNotCreateCotisation"));
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant p-4 flex flex-col gap-4"
    >
      <div>
        <label htmlFor="title" className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
          {t("title")}
        </label>
        <input
          id="title"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Sunday Cycle — Douala Team"
          className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
        />
      </div>

      <div>
        <label htmlFor="type" className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
          {t("frequency")}
        </label>
        <select
          id="type"
          value={type}
          onChange={(e) => handleTypeChange(e.target.value as TontineTypeKey)}
          className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md bg-white"
        >
          {Object.keys(TONTINE_CONFIG).map((key) => (
            <option key={key} value={key}>
              {TONTINE_LABELS[key]}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="amount" className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
            {t("amountPerSlot")}
          </label>
          <input
            id="amount"
            type="number"
            min="1"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
          />
        </div>
        <div>
          <label htmlFor="fee" className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
            {t("feePerSlot")}
          </label>
          <input
            id="fee"
            type="number"
            min="0"
            required
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
          />
        </div>
      </div>

      <div>
        <label htmlFor="maxSlots" className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
          {t("maxSlotCapacity")}
        </label>
        <input
          id="maxSlots"
          type="number"
          min="0.5"
          step="0.5"
          value={maxSlots}
          onChange={(e) => setMaxSlots(e.target.value)}
          placeholder={t("leaveBlankForNoLimit")}
          className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
        />
        <p className="font-label-sm text-label-sm text-on-surface-variant mt-1">
          {t("maxSlotsHelperText")}
        </p>
      </div>

      <div>
        <label htmlFor="startDate" className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
          {t("startDate")}
        </label>
        <input
          id="startDate"
          type="date"
          required
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
        />
        <p className="font-label-sm text-label-sm text-on-surface-variant mt-1">
          {t("startDateHelperText")}
        </p>
      </div>

      <div>
        <label htmlFor="limitTime" className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
          {t("dailyDeadlineLabel")}
        </label>
        <input
          id="limitTime"
          required
          value={limitTime}
          onChange={(e) => setLimitTime(e.target.value)}
          className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
        />
      </div>

      <div>
        <label htmlFor="rules" className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
          {t("rulesOptional")}
        </label>
        <textarea
          id="rules"
          rows={4}
          value={rules}
          onChange={(e) => setRules(e.target.value)}
          className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
        />
      </div>

      {error && <p className="font-label-sm text-label-sm text-error">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-3 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 active:scale-95 transition-all disabled:opacity-60"
      >
        {loading ? t("creatingEllipsis") : t("createCotisation")}
      </button>
    </form>
  );
}
