"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { translate, type Lang } from "@/lib/i18n/translations";
import { parseJsonOrThrow, friendlyErrorMessage } from "@/lib/api-error";

const SLOT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

interface MemberDraftManagerProps {
  tontineSessionId: string;
  lang: Lang;
  currentSlotCount: number;
  currentNames: string[];
}

export function MemberDraftManager({
  tontineSessionId,
  lang,
  currentSlotCount,
  currentNames,
}: MemberDraftManagerProps) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const router = useRouter();

  const [showEditModal, setShowEditModal] = useState(false);
  const [slotCount, setSlotCount] = useState<number>(currentSlotCount || 1);
  const [names, setNames] = useState<string[]>(
    currentNames && currentNames.length > 0 ? currentNames : [""],
  );
  const [savingSlots, setSavingSlots] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [adjustedNotice, setAdjustedNotice] = useState<string | null>(null);

  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  function openEditModal() {
    setSlotCount(currentSlotCount || 1);
    const initial = currentNames && currentNames.length > 0 ? [...currentNames] : [""];
    while (initial.length < (currentSlotCount || 1)) initial.push("");
    setNames(initial.slice(0, currentSlotCount || 1));
    setEditError(null);
    setAdjustedNotice(null);
    setShowEditModal(true);
  }

  function handleSlotCountChange(next: number) {
    setSlotCount(next);
    setNames((current) => {
      const copy = current.slice(0, next);
      while (copy.length < next) copy.push("");
      return copy;
    });
  }

  async function handleSaveSlots(e: React.FormEvent) {
    e.preventDefault();
    if (names.some((n) => !n.trim())) {
      setEditError(t("fillAllNames"));
      return;
    }
    setSavingSlots(true);
    setEditError(null);
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
        setSavingSlots(false);
      } else {
        setShowEditModal(false);
        router.refresh();
      }
    } catch (err) {
      setEditError(friendlyErrorMessage(err, t("couldNotSaveSlots")));
      setSavingSlots(false);
    }
  }

  async function handleLeave() {
    if (!window.confirm(t("confirmLeaveCotisation"))) return;
    setLeaving(true);
    setLeaveError(null);
    try {
      const res = await fetch(`/api/sessions/${tontineSessionId}/leave`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLeaveError(data.error || t("couldNotLeaveCotisation"));
        return;
      }
      router.push("/sessions");
    } catch {
      setLeaveError(t("couldNotLeaveCotisation"));
    } finally {
      setLeaving(false);
    }
  }

  return (
    <>
      <div className="mb-stack-gap-lg bg-surface rounded-xl p-5 shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-primary/20 bg-gradient-to-r from-primary/5 via-surface to-surface">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-2xl">event_repeat</span>
            <div>
              <h2 className="font-title-sm text-title-sm text-primary font-bold">
                {t("manageSlots")}
              </h2>
              <span className="inline-flex items-center gap-1 text-xs text-emerald-700 bg-emerald-100/70 font-medium px-2 py-0.5 rounded">
                <span className="material-symbols-outlined text-[14px]">verified</span>
                {t("memberApprovedBadge")}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={openEditModal}
              className="px-3.5 py-2 rounded-lg bg-primary text-on-primary font-label-sm text-label-sm hover:opacity-90 active:scale-95 transition-all flex items-center gap-1.5 shadow-sm"
            >
              <span className="material-symbols-outlined text-[16px]">edit</span>
              {t("modifyMySlots")}
            </button>
            <button
              type="button"
              onClick={handleLeave}
              disabled={leaving}
              className="px-3.5 py-2 rounded-lg border border-error/30 text-error font-label-sm text-label-sm hover:bg-error/5 active:scale-95 transition-all flex items-center gap-1.5 disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-[16px]">logout</span>
              {leaving ? t("leavingCotisation") : t("leaveCotisation")}
            </button>
          </div>
        </div>

        <p className="font-body-sm text-body-sm text-on-surface-variant leading-relaxed mb-3">
          {t("existingMemberRelaunchNotice")}
        </p>

        <div className="text-xs text-on-surface bg-surface-container-low p-2.5 rounded-lg border border-surface-variant flex items-center justify-between flex-wrap gap-2">
          <span className="font-medium">
            {t("yourSlots")}: <strong className="text-primary">{currentSlotCount} {currentSlotCount > 1 ? t("slots") : t("slot")}</strong>
            {currentNames.length > 0 && ` (${currentNames.join(", ")})`}
          </span>
          <span className="text-on-surface-variant text-[11px]">
            {t("modifySlotsDescription")}
          </span>
        </div>

        {leaveError && <p className="font-label-sm text-label-sm text-error mt-2">{leaveError}</p>}
      </div>

      {showEditModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-xl shadow-xl max-w-md w-full p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-title-md text-title-md text-primary flex items-center gap-2">
                <span className="material-symbols-outlined">tune</span>
                {t("modifyMySlots")}
              </h3>
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                className="text-on-surface-variant hover:text-on-surface"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <p className="font-label-sm text-label-sm text-on-surface-variant">
              {t("modifySlotsDescription")}
            </p>

            {adjustedNotice ? (
              <div className="bg-surface-container-low rounded-xl p-4 flex flex-col gap-3">
                <p className="font-label-sm text-label-sm text-on-surface-variant">{adjustedNotice}</p>
                <button
                  type="button"
                  onClick={() => {
                    setShowEditModal(false);
                    router.refresh();
                  }}
                  className="w-full py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 active:scale-95 transition-all"
                >
                  {t("confirmSlots")}
                </button>
              </div>
            ) : (
              <form onSubmit={handleSaveSlots} className="flex flex-col gap-3">
                <div>
                  <label htmlFor="modalSlotCount" className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
                    {t("contributionSlots")}
                  </label>
                  <select
                    id="modalSlotCount"
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
                      placeholder={`${t("slot")} ${i + 1}`}
                      className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
                    />
                  </div>
                ))}

                {editError && <p className="font-label-sm text-label-sm text-error">{editError}</p>}

                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowEditModal(false)}
                    className="flex-1 border border-outline-variant text-on-surface font-label-md text-label-md py-2.5 rounded-lg hover:bg-surface active:scale-95 transition-all"
                  >
                    {t("cancel")}
                  </button>
                  <button
                    type="submit"
                    disabled={savingSlots}
                    className="flex-1 bg-primary text-on-primary font-label-md text-label-md py-2.5 rounded-lg hover:opacity-90 active:scale-95 transition-all disabled:opacity-60"
                  >
                    {savingSlots ? t("saving") : t("saveChanges")}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
