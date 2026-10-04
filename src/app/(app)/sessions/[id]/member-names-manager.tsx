"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { translate, type Lang } from "@/lib/i18n/translations";
import { parseJsonOrThrow, friendlyErrorMessage } from "@/lib/api-error";

interface MemberNamesManagerProps {
  tontineSessionId: string;
  lang: Lang;
  currentNames: string[];
  sessionStatus: "DRAFT" | "ACTIVE" | "DRAWING" | "CLOSED";
  maxSlots?: number | null;
  startDate?: string | Date | null;
}

export function MemberNamesManager({
  tontineSessionId,
  lang,
  currentNames,
  sessionStatus,
  maxSlots,
  startDate,
}: MemberNamesManagerProps) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const router = useRouter();

  // Comes closed by default as instructed
  const [isOpen, setIsOpen] = useState(false);
  const [names, setNames] = useState<string[]>(
    currentNames && currentNames.length > 0 ? currentNames : [""],
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  // Adding, deleting names, and leaving are ONLY possible if the cotisation has not yet started
  const isStarted =
    sessionStatus !== "DRAFT" || (startDate ? new Date() >= new Date(startDate) : false);
  const canEditNames = !isStarted;
  const canLeave = !isStarted;
  const slotLimit = maxSlots ? Math.min(Number(maxSlots), 10) : 10;

  function handleAddName() {
    if (!canEditNames) return;
    if (names.length >= slotLimit) return;
    setNames([...names, ""]);
    setSaveError(null);
    setSuccessMessage(null);
  }

  function handleRemoveName(indexToRemove: number) {
    if (!canEditNames) return;
    if (names.length <= 1) {
      setSaveError(
        lang === "fr"
          ? "Vous devez avoir au moins un nom. Pour vous retirer complètement, utilisez le bouton « Quitter la cotisation » ci-dessous."
          : "You must keep at least one name. To exit completely, use the 'Leave cotisation' button below.",
      );
      return;
    }
    setNames(names.filter((_, idx) => idx !== indexToRemove));
    setSaveError(null);
    setSuccessMessage(null);
  }

  function handleNameChange(index: number, val: string) {
    setNames(names.map((n, i) => (i === index ? val : n)));
    setSaveError(null);
    setSuccessMessage(null);
  }

  async function handleSaveNames(e: React.FormEvent) {
    e.preventDefault();
    if (!canEditNames) return;

    if (names.some((n) => !n.trim())) {
      setSaveError(
        lang === "fr"
          ? "Veuillez renseigner tous les noms avant d'enregistrer."
          : "Please fill in all names before saving.",
      );
      return;
    }

    setSaving(true);
    setSaveError(null);
    setSuccessMessage(null);

    try {
      const trimmed = names.map((n) => n.trim());
      const res = await fetch(`/api/sessions/${tontineSessionId}/slots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slotCount: trimmed.length,
          beneficiaryNames: trimmed,
        }),
      });

      await parseJsonOrThrow(res, t("couldNotSaveSlots"));
      setSuccessMessage(
        lang === "fr"
          ? "Vos noms ont été enregistrés avec succès."
          : "Your names have been updated successfully.",
      );
      router.refresh();
    } catch (err) {
      setSaveError(friendlyErrorMessage(err, t("couldNotSaveSlots")));
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
                ? `${names.length} nom${names.length > 1 ? "s" : ""} enregistré${names.length > 1 ? "s" : ""} · Cliquez pour voir ou modifier`
                : `${names.length} registered name${names.length > 1 ? "s" : ""} · Click to view`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-on-surface-variant">
          <span className="font-label-sm text-xs hidden sm:inline">
            {isOpen ? (lang === "fr" ? "Fermer" : "Close") : (lang === "fr" ? "Ouvrir" : "Open")}
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
          {canEditNames ? (
            /* Editable when cotisation hasn't started yet */
            <form onSubmit={handleSaveNames} className="flex flex-col gap-3.5">
              <p className="text-xs text-on-surface-variant leading-relaxed">
                {lang === "fr"
                  ? "La cotisation n'a pas encore commencé. Vous pouvez ajouter de nouveaux noms ou supprimer ceux que vous ne souhaitez plus conserver :"
                  : "The cotisation has not started yet. You can add new names or remove existing ones:"}
              </p>

              <div className="space-y-2.5">
                {names.map((name, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-6 text-xs font-bold text-on-surface-variant text-center flex-shrink-0">
                      #{i + 1}
                    </span>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => handleNameChange(i, e.target.value)}
                      placeholder={`${lang === "fr" ? "Nom complet" : "Full name"} #${i + 1}`}
                      className="flex-1 border border-outline-variant rounded-lg px-3 py-2 font-label-md text-sm bg-white focus:outline-hidden focus:border-primary"
                    />
                    {names.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveName(i)}
                        title={lang === "fr" ? "Supprimer ce nom" : "Remove this name"}
                        className="w-9 h-9 rounded-lg border border-error/20 text-error hover:bg-error/10 flex items-center justify-center flex-shrink-0 cursor-pointer transition-colors"
                      >
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {names.length < slotLimit && (
                <button
                  type="button"
                  onClick={handleAddName}
                  className="self-start text-xs font-bold text-primary hover:text-primary/80 flex items-center gap-1.5 py-1 px-2 rounded-md hover:bg-primary/5 cursor-pointer transition-colors"
                >
                  <span className="material-symbols-outlined text-base">add_circle</span>
                  <span>{lang === "fr" ? "Ajouter un autre nom" : "Add another name"}</span>
                </button>
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
            /* Read-only when cotisation has started */
            <div className="flex flex-col gap-2.5">
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-900 flex items-center gap-2">
                <span className="material-symbols-outlined text-base text-amber-700">lock</span>
                <span>
                  {lang === "fr"
                    ? "La cotisation est déjà en cours ou en tirage. L'ajout et la suppression de noms sont désormais verrouillés."
                    : "The cotisation is already ongoing or in drawing. Adding or removing names is locked."}
                </span>
              </div>

              <div className="space-y-2 mt-1">
                {names.map((name, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2.5 p-2.5 rounded-lg bg-surface-container-low border border-surface-variant"
                  >
                    <span className="w-6 text-xs font-bold text-primary text-center">
                      #{i + 1}
                    </span>
                    <span className="font-label-md text-sm font-semibold text-on-surface">
                      {name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Option to leave group (only possible before draw / before cotisation starts) */}
          {canLeave ? (
            <div className="mt-2 pt-4 border-t border-surface-variant flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-on-surface">
                  {lang === "fr" ? "Quitter le groupe de cotisation" : "Leave Cotisation Group"}
                </p>
                <p className="text-[11px] text-on-surface-variant mt-0.5">
                  {lang === "fr"
                    ? "Retirez votre participation de ce groupe avant le début de la cotisation."
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
              <span>
                {t("cannotLeaveCotisationStarted")}
              </span>
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
