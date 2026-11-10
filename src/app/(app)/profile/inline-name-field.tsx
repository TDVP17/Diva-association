"use client";

import { useActionState, useState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { translate, type Lang } from "@/lib/i18n/translations";
import { updateNameAction, type ProfileFormState } from "./actions";

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 active:scale-95 text-white font-semibold text-sm shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
    >
      {pending && (
        <span className="material-symbols-outlined text-[18px] animate-spin">
          progress_activity
        </span>
      )}
      <span>{label}</span>
    </button>
  );
}

const initialState: ProfileFormState = {};

interface EditNameModalProps {
  open: boolean;
  onClose: () => void;
  currentName: string;
  onNameSaved: (newName: string) => void;
  lang: Lang;
}

function EditNameModal({
  open,
  onClose,
  currentName,
  onNameSaved,
  lang,
}: EditNameModalProps) {
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  const router = useRouter();
  const [nameValue, setNameValue] = useState(currentName);
  const [state, formAction] = useActionState(updateNameAction, initialState);

  useEffect(() => {
    setNameValue(currentName);
  }, [currentName, open]);

  useEffect(() => {
    if (state.success && open) {
      onNameSaved(nameValue.trim());
      router.refresh();
      onClose();
    }
  }, [state.success, open, nameValue, onNameSaved, router, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-white rounded-2xl p-6 shadow-2xl border border-slate-100 animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[20px]">badge</span>
            </span>
            <div>
              <h3 className="font-bold text-base text-slate-900 leading-snug">
                {t("editName")}
              </h3>
              <p className="text-xs text-slate-500">{t("nameLabel")}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg transition-colors"
            aria-label={t("cancel")}
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>

        <p className="text-xs text-slate-600 mb-4 bg-slate-50 border border-slate-200/70 rounded-lg p-2.5 leading-relaxed">
          {t("realNamePrompt")}
        </p>

        <form action={formAction} className="flex flex-col gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              {t("nameLabel")}
            </label>
            <input
              type="text"
              name="name"
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              placeholder="Ex: Valentine Parfaite"
              minLength={2}
              maxLength={70}
              required
              autoFocus
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 text-slate-900 font-medium text-sm outline-none transition-all placeholder:text-slate-400"
            />
          </div>

          {state.error && (
            <p className="text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg p-2.5">
              {state.error}
            </p>
          )}

          <div className="flex flex-col gap-2 pt-1">
            <SaveButton label={t("save")} />
            <button
              type="button"
              onClick={onClose}
              className="w-full py-2 rounded-xl border border-slate-200 text-slate-600 font-medium text-sm hover:bg-slate-50 transition-colors"
            >
              {t("cancel")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Row displayed inside the personal info card */
export function InlineNameField({
  currentName,
  lang,
}: {
  currentName: string;
  lang: Lang;
}) {
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(currentName);

  useEffect(() => {
    setName(currentName);
  }, [currentName]);

  return (
    <>
      <div className="flex justify-between items-center px-4 py-3 border-b border-surface-variant">
        <span className="font-label-sm text-label-sm text-on-surface-variant">
          {t("nameLabel")}
        </span>
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-label-md text-label-md text-on-surface font-semibold truncate max-w-[190px]">
            {name}
          </span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="p-1 text-outline hover:text-emerald-700 transition-colors cursor-pointer shrink-0"
            aria-label={t("editName")}
            title={t("editName")}
          >
            <span className="material-symbols-outlined text-[18px]">edit</span>
          </button>
        </div>
      </div>

      <EditNameModal
        open={open}
        onClose={() => setOpen(false)}
        currentName={name}
        onNameSaved={setName}
        lang={lang}
      />
    </>
  );
}

/** Header displayed under the avatar at the top of the profile */
export function EditableProfileHeader({
  name: initialName,
  lang,
}: {
  name: string;
  lang: Lang;
}) {
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName);

  useEffect(() => {
    setName(initialName);
  }, [initialName]);

  return (
    <>
      <div className="flex items-center justify-center gap-2 mt-3 group">
        <h1 className="font-title-md text-title-md text-primary font-bold text-center">
          {name}
        </h1>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="p-1 rounded-full text-slate-400 hover:text-emerald-700 hover:bg-emerald-50 transition-colors cursor-pointer"
          aria-label={t("editName")}
          title={t("editName")}
        >
          <span className="material-symbols-outlined text-[18px]">edit</span>
        </button>
      </div>

      <EditNameModal
        open={open}
        onClose={() => setOpen(false)}
        currentName={name}
        onNameSaved={setName}
        lang={lang}
      />
    </>
  );
}
