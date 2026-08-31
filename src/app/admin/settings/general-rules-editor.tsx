"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { translate, type Lang } from "@/lib/i18n/translations";
import { saveGeneralRulesAction, type GeneralRulesFormState } from "./actions";

function SaveButton({ label, savingLabel }: { label: string; savingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="py-2.5 px-5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 active:scale-95 transition-all disabled:opacity-60"
    >
      {pending ? savingLabel : label}
    </button>
  );
}

const initialState: GeneralRulesFormState = {};

export function GeneralRulesEditor({ initialContent, lang }: { initialContent: string; lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  const [state, formAction] = useActionState(saveGeneralRulesAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <textarea
        name="content"
        rows={10}
        defaultValue={initialContent}
        className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
      />
      {state.error && <p className="font-label-sm text-label-sm text-error">{state.error}</p>}
      {state.success && <p className="font-label-sm text-label-sm text-primary">{state.success}</p>}
      <SaveButton label={t("saveGeneralRules")} savingLabel={t("saving")} />
    </form>
  );
}
