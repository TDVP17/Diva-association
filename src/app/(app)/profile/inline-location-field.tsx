"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { translate, type Lang } from "@/lib/i18n/translations";
import { updateProfileAction, type ProfileFormState } from "./actions";

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 active:scale-95 transition-all disabled:opacity-60"
    >
      {label}
    </button>
  );
}

const initialState: ProfileFormState = {};

/** City/neighborhood are low-risk fields (unlike email/phone/password), so this skips the OTP gate entirely. */
export function InlineLocationField({
  city,
  neighborhood,
  lang,
}: {
  city: string | null;
  neighborhood: string | null;
  lang: Lang;
}) {
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(updateProfileAction, initialState);

  if (state.success && open) {
    router.refresh();
    setOpen(false);
  }

  const summary = [city, neighborhood].filter(Boolean).join(", ") || t("notSet");

  return (
    <>
      <div className="flex justify-between items-center px-4 py-3">
        <span className="font-label-sm text-label-sm text-on-surface-variant">{t("locationLabel")}</span>
        <div className="flex items-center gap-2">
          <span className="font-label-md text-label-md text-on-surface">{summary}</span>
          <button
            onClick={() => setOpen(true)}
            className="p-1 text-outline hover:text-primary transition-colors"
            aria-label={t("locationLabel")}
          >
            <span className="material-symbols-outlined text-[18px]">edit</span>
          </button>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-container-padding bg-black/50">
          <div className="w-full max-w-sm bg-white rounded-2xl p-5 shadow-xl">
            <h2 className="font-title-md text-title-md text-on-surface mb-stack-gap-md">{t("locationLabel")}</h2>
            <form action={formAction} className="flex flex-col gap-3">
              <input
                name="city"
                defaultValue={city ?? ""}
                placeholder={t("cityLabel")}
                className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
              />
              <input
                name="neighborhood"
                defaultValue={neighborhood ?? ""}
                placeholder={t("neighborhoodLabel")}
                className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
              />
              {state.error && <p className="font-label-sm text-label-sm text-error">{state.error}</p>}
              <SaveButton label={t("save")} />
            </form>
            <button
              onClick={() => setOpen(false)}
              className="w-full mt-3 py-2 rounded-lg border border-outline-variant text-on-surface-variant font-label-md text-label-md hover:bg-surface-container-low"
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
