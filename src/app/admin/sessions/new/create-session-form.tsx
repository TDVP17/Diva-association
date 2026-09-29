"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TONTINE_CONFIG } from "@/lib/tontine-engine";
import { getFrequencyOptionGroups } from "@/lib/tontine-labels";
import { translate, type Lang } from "@/lib/i18n/translations";
import { parseJsonOrThrow, friendlyErrorMessage } from "@/lib/api-error";

type TontineTypeKey = keyof typeof TONTINE_CONFIG;

export function CreateSessionForm({ lang }: { lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const router = useRouter();
  const frequencyGroups = getFrequencyOptionGroups(lang);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<TontineTypeKey>("HEBDO_SUNDAY");
  const [amount, setAmount] = useState(String(TONTINE_CONFIG.HEBDO_SUNDAY.amount));
  const [fee, setFee] = useState(String(TONTINE_CONFIG.HEBDO_SUNDAY.fee));
  const [fineAmountPerPeriod, setFineAmountPerPeriod] = useState(
    String(TONTINE_CONFIG.HEBDO_SUNDAY.fineAmountPerPeriod),
  );
  const [fineIntervalHours, setFineIntervalHours] = useState(
    String(TONTINE_CONFIG.HEBDO_SUNDAY.fineIntervalHours),
  );
  const [startDate, setStartDate] = useState("");
  const [drawDate, setDrawDate] = useState("");
  const [limitTime, setLimitTime] = useState("18:31");
  const [maxSlots, setMaxSlots] = useState("");
  const [status, setStatus] = useState<"DRAFT" | "ACTIVE">("DRAFT");
  const [validatedMembersCount, setValidatedMembersCount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleTypeChange(next: TontineTypeKey) {
    setType(next);
    setAmount(String(TONTINE_CONFIG[next].amount));
    setFee(String(TONTINE_CONFIG[next].fee));
    setFineAmountPerPeriod(String(TONTINE_CONFIG[next].fineAmountPerPeriod));
    setFineIntervalHours(String(TONTINE_CONFIG[next].fineIntervalHours));
  }

  function handleStartDateChange(next: string) {
    setStartDate(next);
    if (!drawDate && next) {
      const suggested = new Date(next);
      suggested.setUTCDate(suggested.getUTCDate() - 1);
      setDrawDate(suggested.toISOString().slice(0, 10));
    }
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
          description: description || undefined,
          type,
          amount: Number(amount),
          fee: Number(fee),
          fineAmountPerPeriod: Number(fineAmountPerPeriod),
          fineIntervalHours: Number(fineIntervalHours),
          startDate,
          drawDate,
          limitTime,
          maxSlots: maxSlots ? Number(maxSlots) : undefined,
          status,
          validatedMembersCount: status === "ACTIVE" && validatedMembersCount ? Number(validatedMembersCount) : 0,
        }),
      });
      await parseJsonOrThrow(res, t("couldNotCreateCotisation"));
      router.push("/admin");
      router.refresh();
    } catch (err) {
      setError(friendlyErrorMessage(err, t("couldNotCreateCotisation")));
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
          placeholder={t("sessionTitlePlaceholder")}
          className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
        />
      </div>

      <div>
        <label htmlFor="description" className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
          {t("descriptionLabel")}
        </label>
        <textarea
          id="description"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
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
          {frequencyGroups.map((group) => (
            <optgroup key={group.group} label={group.group}>
              {group.options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </optgroup>
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

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label
            htmlFor="fineAmountPerPeriod"
            className="font-label-sm text-label-sm text-on-surface-variant block mb-1"
          >
            {t("fineAmountLabel")}
          </label>
          <input
            id="fineAmountPerPeriod"
            type="number"
            min="0"
            required
            value={fineAmountPerPeriod}
            onChange={(e) => setFineAmountPerPeriod(e.target.value)}
            className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
          />
        </div>
        <div>
          <label
            htmlFor="fineIntervalHours"
            className="font-label-sm text-label-sm text-on-surface-variant block mb-1"
          >
            {t("fineIntervalLabel")}
          </label>
          <input
            id="fineIntervalHours"
            type="number"
            min="1"
            required
            value={fineIntervalHours}
            onChange={(e) => setFineIntervalHours(e.target.value)}
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
          onChange={(e) => handleStartDateChange(e.target.value)}
          className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
        />
        <p className="font-label-sm text-label-sm text-on-surface-variant mt-1">
          {t("startDateHelperText")}
        </p>
      </div>

      <div>
        <label htmlFor="drawDate" className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
          {t("drawDateLabel")}
        </label>
        <input
          id="drawDate"
          type="date"
          required
          value={drawDate}
          onChange={(e) => setDrawDate(e.target.value)}
          className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
        />
        <p className="font-label-sm text-label-sm text-on-surface-variant mt-1">{t("drawDateHelperText")}</p>
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

      {/* Statut & Membres validés */}
      <div className="p-4 rounded-xl bg-surface-container-low border border-surface-variant flex flex-col gap-3">
        <div>
          <label htmlFor="status" className="font-label-sm text-label-sm text-on-surface font-semibold block mb-1">
            {t("cotisationStatusLabel")}
          </label>
          <select
            id="status"
            value={status}
            onChange={(e) => {
              const nextStatus = e.target.value as "DRAFT" | "ACTIVE";
              setStatus(nextStatus);
              if (nextStatus !== "ACTIVE") {
                setValidatedMembersCount("");
              }
            }}
            className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md bg-white font-medium"
          >
            <option value="DRAFT">{t("statusDraftOption")}</option>
            <option value="ACTIVE">{t("statusActiveOption")}</option>
          </select>
          <p className="font-label-sm text-xs text-on-surface-variant mt-1">
            {status === "ACTIVE" ? t("statusActiveHelper") : t("statusDraftHelper")}
          </p>
        </div>

        {status === "ACTIVE" && (
          <div className="pt-2 border-t border-surface-variant animate-in fade-in duration-200">
            <label htmlFor="validatedMembersCount" className="font-label-sm text-label-sm text-on-surface font-semibold block mb-1">
              {t("validatedMembersCountLabel")}
            </label>
            <input
              id="validatedMembersCount"
              type="number"
              min="1"
              value={validatedMembersCount}
              onChange={(e) => setValidatedMembersCount(e.target.value)}
              placeholder="Ex: 12"
              className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md bg-white font-medium"
            />
            <p className="font-label-sm text-xs text-on-surface-variant mt-1">
              {t("validatedMembersCountHelper")}
            </p>
          </div>
        )}

        {/* Live Calculation preview: Montant + Frais et Pot Total */}
        {(() => {
          const numAmount = Number(amount) || 0;
          const numFee = Number(fee) || 0;
          const count = status === "ACTIVE" ? Number(validatedMembersCount) || 0 : 0;
          const pot = count > 0 ? Math.round(count * numAmount + count * numFee * 0.25) : 0;
          return (
            <div className="mt-1 pt-3 border-t border-surface-variant flex flex-col gap-1.5 text-xs">
              <div className="flex justify-between items-center text-on-surface-variant">
                <span>{t("totalAmountPerSlot")} :</span>
                <span className="font-semibold text-on-surface font-numeric-data">
                  {numAmount.toLocaleString("fr-FR")} FCFA + {numFee.toLocaleString("fr-FR")} FCFA ({t("feeLabel")}) = {(numAmount + numFee).toLocaleString("fr-FR")} FCFA
                </span>
              </div>
              {status === "ACTIVE" && count > 0 && (
                <div className="flex justify-between items-center text-emerald-800 font-semibold bg-emerald-50 px-2.5 py-1.5 rounded-lg border border-emerald-200">
                  <span className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm text-emerald-600">emoji_events</span>
                    {t("totalPotToEat")} ({count} {t("validatedMembersCountLabel").toLowerCase()}) :
                  </span>
                  <span className="font-bold text-sm font-numeric-data">{pot.toLocaleString("fr-FR")} FCFA</span>
                </div>
              )}
            </div>
          );
        })()}
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
