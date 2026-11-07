"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { translate, type Lang } from "@/lib/i18n/translations";
import { parseJsonOrThrow, friendlyErrorMessage, ApiError } from "@/lib/api-error";

export interface MemberSlotEntry {
  id: string;
  beneficiaryName: string;
  officialPosition?: number | null;
}

interface EditableSlotItem {
  id: string | null;
  name: string;
  officialPosition?: number | null;
}

interface MemberNamesManagerProps {
  tontineSessionId: string;
  lang: Lang;
  currentNames: string[];
  currentSlots?: MemberSlotEntry[];
  sessionStatus: "DRAFT" | "ACTIVE" | "DRAWING" | "CLOSED";
  maxSlots?: number | null;
  startDate?: string | Date | null;
  isFinished?: boolean;
}

function buildEditableItems(
  currentNames: string[],
  currentSlots?: MemberSlotEntry[],
): EditableSlotItem[] {
  if (currentSlots && currentSlots.length > 0) {
    return currentSlots.map((s) => ({
      id: s.id,
      name: s.beneficiaryName,
      officialPosition: s.officialPosition ?? null,
    }));
  }
  if (currentNames && currentNames.length > 0) {
    return currentNames.map((name) => ({ id: null, name, officialPosition: null }));
  }
  return [{ id: null, name: "", officialPosition: null }];
}

export function MemberNamesManager({
  tontineSessionId,
  lang,
  currentNames,
  currentSlots,
  sessionStatus,
  isFinished = false,
}: MemberNamesManagerProps) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const router = useRouter();

  // Comes closed by default as instructed
  const [isOpen, setIsOpen] = useState(false);
  const [items, setItems] = useState<EditableSlotItem[]>(() =>
    buildEditableItems(currentNames, currentSlots),
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  // Sync items when server props update
  useEffect(() => {
    setItems(buildEditableItems(currentNames, currentSlots));
  }, [currentNames, currentSlots]);

  // Adding/removing names & leaving are only allowed in DRAFT or when the cycle is finished.
  // Renaming existing names is ALSO allowed when the cotisation is ongoing (DRAWING / ACTIVE).
  const canAddOrRemoveNames = sessionStatus === "DRAFT" || isFinished;
  const canRenameNames = sessionStatus !== "CLOSED" || isFinished;
  const isRenameOnly = canRenameNames && !canAddOrRemoveNames;
  const canLeave = sessionStatus === "DRAFT" || isFinished;
  const slotLimit = 15;

  function handleAddMultiple(count: number) {
    if (!canAddOrRemoveNames) return;
    const remaining = slotLimit - items.length;
    const toAdd = Math.min(count, remaining);
    if (toAdd <= 0) return;
    const emptySlots: EditableSlotItem[] = Array.from({ length: toAdd }, () => ({
      id: null,
      name: "",
      officialPosition: null,
    }));
    setItems([...items, ...emptySlots]);
    setSaveError(null);
    setSuccessMessage(null);
  }

  async function handleRemoveName(indexToRemove: number) {
    if (!canAddOrRemoveNames || saving) return;
    if (items.length <= 1) {
      setSaveError(
        lang === "fr"
          ? "Vous devez avoir au moins un nom. Pour vous retirer complètement, utilisez le bouton « Quitter la cotisation » ci-dessous."
          : "You must keep at least one name. To exit completely, use the 'Leave cotisation' button below.",
      );
      return;
    }

    const nameToRemove = items[indexToRemove]?.name.trim() || `#${indexToRemove + 1}`;
    const confirmMessage =
      lang === "fr"
        ? `Êtes-vous sûr de vouloir supprimer le nom « ${nameToRemove} » de cette cotisation ?`
        : `Êtes-vous sûr ? Are you sure you want to remove "${nameToRemove}" from this cotisation?`;

    if (!window.confirm(confirmMessage)) {
      return;
    }

    const updated = items.filter((_, idx) => idx !== indexToRemove);
    setItems(updated);
    setSaveError(null);
    setSuccessMessage(null);
    setSaving(true);

    try {
      const trimmed = updated.map((it) => it.name.trim());
      const slotIds = updated.map((it) => it.id);
      const res = await fetch(`/api/sessions/${tontineSessionId}/slots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slotCount: trimmed.length,
          beneficiaryNames: trimmed,
          slotIds,
        }),
      });

      await parseJsonOrThrow(res, t("couldNotSaveSlots"));
      setSuccessMessage(
        lang === "fr"
          ? `Le nom « ${nameToRemove} » a été supprimé avec succès.`
          : `The name "${nameToRemove}" has been successfully removed.`,
      );
      router.refresh();
    } catch (err) {
      setSaveError(friendlyErrorMessage(err, t("couldNotSaveSlots")));
    } finally {
      setSaving(false);
    }
  }

  function handleNameChange(index: number, val: string) {
    setItems(items.map((it, i) => (i === index ? { ...it, name: val } : it)));
    setSaveError(null);
    setSuccessMessage(null);
  }

  async function handleSaveNames(e: React.FormEvent) {
    e.preventDefault();
    if (!canRenameNames) return;

    if (items.some((it) => !it.name.trim())) {
      setSaveError(
        lang === "fr"
          ? canAddOrRemoveNames
            ? "Veuillez renseigner un nom pour chaque case ou supprimer les cases vides avec l'icône corbeille rouge."
            : "Veuillez renseigner un nom valide dans chaque case."
          : canAddOrRemoveNames
            ? "Please fill in all names or remove empty fields with the red trash icon before saving."
            : "Please enter a valid name for each slot.",
      );
      return;
    }

    setSaving(true);
    setSaveError(null);
    setSuccessMessage(null);

    try {
      const trimmed = items.map((it) => it.name.trim());
      const slotIds = items.map((it) => it.id);
      const res = await fetch(`/api/sessions/${tontineSessionId}/slots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slotCount: trimmed.length,
          beneficiaryNames: trimmed,
          slotIds,
        }),
      });

      const data = await parseJsonOrThrow<{ ok?: boolean; beneficiaryNames?: string[] }>(
        res,
        t("couldNotSaveSlots"),
      );
      if (data?.beneficiaryNames && data.beneficiaryNames.length === items.length) {
        setItems(
          items.map((it, idx) => ({
            ...it,
            name: data.beneficiaryNames![idx],
          })),
        );
      }
      setSuccessMessage(
        lang === "fr"
          ? `Vos ${trimmed.length} nom(s) ont été enregistrés avec succès.`
          : `Your ${trimmed.length} name(s) have been updated successfully.`,
      );
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.message && err.message !== t("couldNotSaveSlots")) {
        setSaveError(err.message);
      } else {
        setSaveError(friendlyErrorMessage(err, t("couldNotSaveSlots")));
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleLeave() {
    if (
      !window.confirm(
        lang === "fr"
          ? "Êtes-vous sûr de vouloir quitter cette cotisation ?"
          : "Are you sure you want to leave this cotisation?",
      )
    ) {
      return;
    }

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
      window.location.href = "/sessions";
    } catch {
      setLeaveError(t("couldNotLeaveCotisation"));
    } finally {
      setLeaving(false);
    }
  }

  return (
    <div className="mb-stack-gap-lg bg-surface rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant overflow-hidden">
      {/* Accordion Header (Closed by default) */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-4 flex items-center justify-between hover:bg-surface-container-low transition-colors cursor-pointer text-left"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-[22px]">badge</span>
          </div>
          <div>
            <h2 className="font-title-sm text-title-sm text-primary font-bold">
              {lang === "fr" ? "Mes noms enregistrés" : "My Registered Names"}
            </h2>
            <p className="font-label-sm text-xs text-on-surface-variant mt-0.5">
              {isOpen
                ? lang === "fr"
                  ? "Cliquez pour refermer"
                  : "Click to close"
                : lang === "fr"
                  ? `${items.length} nom${items.length > 1 ? "s" : ""} enregistré${items.length > 1 ? "s" : ""} · Cliquez pour voir ou modifier`
                  : `${items.length} registered name${items.length > 1 ? "s" : ""} · Click to view or edit`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-on-surface-variant">
          <span className="font-label-sm text-xs hidden sm:inline">
            {isOpen ? (lang === "fr" ? "Fermer" : "Close") : (lang === "fr" ? "Modifier" : "Edit")}
          </span>
          <span
            className={`material-symbols-outlined text-2xl transition-transform duration-200 ${
              isOpen ? "rotate-180" : ""
            }`}
          >
            expand_more
          </span>
        </div>
      </button>

      {/* Accordion Body */}
      {isOpen && (
        <div className="p-5 pt-3 border-t border-surface-variant animate-in fade-in duration-200 flex flex-col gap-4">
          {canRenameNames ? (
            <form onSubmit={handleSaveNames} className="flex flex-col gap-3.5">
              {isRenameOnly ? (
                <div className="p-3 rounded-lg bg-emerald-50/90 border border-emerald-200 text-xs text-emerald-950 flex items-start gap-2">
                  <span className="material-symbols-outlined text-base text-emerald-700 mt-0.5">
                    edit_note
                  </span>
                  <span className="leading-relaxed">
                    {lang === "fr"
                      ? "Vous pouvez modifier l'écriture de vos noms ci-dessous (vos places de bouffe et vos cotisations payées restent conservées). L'ajout ou le retrait de parts en cours de cotisation se fait uniquement par l'administrateur."
                      : "You can rename your registered names below (your payout positions and paid contributions are preserved). Adding or removing slots during an active cotisation is handled by the administrator."}
                  </span>
                </div>
              ) : (
                <p className="text-xs text-on-surface-variant leading-relaxed">
                  {lang === "fr"
                    ? isFinished
                      ? "Ce cycle de cotisation est terminé. Vous pouvez dès maintenant ajuster vos noms (ajouter jusqu'à 15 noms ou retirer) ou quitter avant le prochain cycle :"
                      : "La cotisation n'a pas encore commencé. Vous pouvez modifier vos noms, en ajouter jusqu'à 15 ou supprimer ceux que vous ne souhaitez plus conserver :"
                    : isFinished
                      ? "This cycle has finished. You can now adjust your names (up to 15 names) or leave before the next cycle starts:"
                      : "The cotisation has not started yet. You can rename, register up to 15 names, or remove existing ones:"}
                </p>
              )}

              <div className="space-y-2.5">
                {items.map((item, i) => (
                  <div key={item.id ?? `new-${i}`} className="flex items-center gap-2">
                    {item.officialPosition ? (
                      <span
                        title={
                          lang === "fr"
                            ? `Place #${item.officialPosition} dans l'ordre de bouffe`
                            : `Place #${item.officialPosition} in payout order`
                        }
                        className="px-2 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-bold text-center flex-shrink-0"
                      >
                        #{item.officialPosition}
                      </span>
                    ) : (
                      <span className="w-6 text-xs font-bold text-on-surface-variant text-center flex-shrink-0">
                        #{i + 1}
                      </span>
                    )}
                    <input
                      type="text"
                      value={item.name}
                      onChange={(e) => handleNameChange(i, e.target.value)}
                      placeholder={`${lang === "fr" ? "Nom complet" : "Full name"} #${i + 1}`}
                      className="flex-1 border border-outline-variant rounded-lg px-3 py-2 font-label-md text-sm bg-white focus:outline-hidden focus:border-primary"
                    />
                    {canAddOrRemoveNames && items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveName(i)}
                        disabled={saving}
                        title={lang === "fr" ? "Supprimer ce nom" : "Remove this name"}
                        className="w-9 h-9 rounded-lg border border-error/20 text-error hover:bg-error/10 flex items-center justify-center flex-shrink-0 cursor-pointer transition-colors disabled:opacity-40"
                      >
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {canAddOrRemoveNames && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {items.length < slotLimit && (
                    <button
                      type="button"
                      onClick={() => handleAddMultiple(1)}
                      className="text-xs font-bold text-primary hover:text-primary/80 flex items-center gap-1.5 py-1.5 px-3 rounded-lg border border-primary/20 bg-primary/5 hover:bg-primary/10 cursor-pointer transition-colors"
                    >
                      <span className="material-symbols-outlined text-[18px]">add_circle</span>
                      <span>{lang === "fr" ? "+1 nom" : "+1 name"}</span>
                    </button>
                  )}
                  {items.length + 5 <= slotLimit && (
                    <button
                      type="button"
                      onClick={() => handleAddMultiple(5)}
                      className="text-xs font-bold text-emerald-800 hover:text-emerald-900 flex items-center gap-1.5 py-1.5 px-3 rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 cursor-pointer transition-colors shadow-2xs"
                    >
                      <span className="material-symbols-outlined text-[18px]">group_add</span>
                      <span>{lang === "fr" ? "+5 noms d'un coup" : "+5 names at once"}</span>
                    </button>
                  )}
                  <span className="text-xs font-semibold text-on-surface-variant ml-auto">
                    {items.length} / {slotLimit} {lang === "fr" ? "noms" : "names"}
                  </span>
                </div>
              )}

              {saveError && (
                <p className="font-label-sm text-xs text-error bg-error/5 p-2 rounded-lg border border-error/20">
                  {saveError}
                </p>
              )}

              {successMessage && (
                <p className="font-label-sm text-xs text-emerald-800 bg-emerald-50 p-2 rounded-lg border border-emerald-200">
                  {successMessage}
                </p>
              )}

              <button
                type="submit"
                disabled={saving}
                className="self-start mt-1 px-5 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-xs font-bold hover:opacity-90 active:scale-95 transition-all shadow-xs cursor-pointer disabled:opacity-60"
              >
                {saving
                  ? lang === "fr"
                    ? "Enregistrement..."
                    : "Saving..."
                  : lang === "fr"
                    ? "Enregistrer les modifications"
                    : "Save Changes"}
              </button>
            </form>
          ) : (
            <div className="space-y-2 mt-1">
              {items.map((item, i) => (
                <div
                  key={item.id ?? i}
                  className="flex items-center gap-2.5 p-2.5 rounded-lg bg-surface-container-low border border-surface-variant"
                >
                  <span className="w-6 text-xs font-bold text-primary text-center">
                    #{item.officialPosition ?? i + 1}
                  </span>
                  <span className="font-label-md text-sm font-semibold text-on-surface">
                    {item.name}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Option to leave group (only possible before draw / before cotisation starts or after cycle finishes) */}
          {canLeave ? (
            <div className="mt-2 pt-4 border-t border-surface-variant flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-on-surface">
                  {lang === "fr" ? "Quitter le groupe de cotisation" : "Leave Cotisation Group"}
                </p>
                <p className="text-[11px] text-on-surface-variant mt-0.5">
                  {lang === "fr"
                    ? isFinished
                      ? "Retirez votre participation pour ne plus être reconduit pour le prochain cycle."
                      : "Retirez votre participation de ce groupe avant le début de la cotisation."
                    : isFinished
                      ? "Leave this group before the next cycle begins."
                      : "Remove your participation from this contribution before it starts."}
                </p>
              </div>
              <button
                type="button"
                onClick={handleLeave}
                disabled={leaving}
                className="px-3.5 py-2 rounded-lg border border-error/30 text-error hover:bg-error/10 font-label-sm text-xs font-bold active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-60 flex-shrink-0"
              >
                <span className="material-symbols-outlined text-[16px]">logout</span>
                <span>
                  {leaving
                    ? lang === "fr"
                      ? "Départ en cours..."
                      : "Leaving..."
                    : lang === "fr"
                      ? "Quitter la cotisation"
                      : "Leave Cotisation"}
                </span>
              </button>
            </div>
          ) : (
            <div className="mt-2 pt-4 border-t border-surface-variant flex items-center gap-2 text-xs text-on-surface-variant bg-surface-container-low p-2.5 rounded-lg">
              <span className="material-symbols-outlined text-[18px] text-outline">lock</span>
              <span>{t("cannotLeaveCotisationStarted")}</span>
            </div>
          )}

          {leaveError && (
            <p className="font-label-sm text-xs text-error bg-error/5 p-2 rounded-lg border border-error/20">
              {leaveError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
