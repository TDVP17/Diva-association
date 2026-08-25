"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { signInAction, signUpAction, type AuthFormState } from "./actions";
import { translate, type Lang, type TranslationKey } from "@/lib/i18n/translations";

const initialState: AuthFormState = {};

function SubmitButton({ children, pendingLabel }: { children: React.ReactNode; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full py-3 rounded-lg bg-primary text-on-primary font-label-md text-label-md shadow-md hover:opacity-90 active:scale-95 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
    >
      {pending && (
        <span
          aria-hidden
          className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"
        />
      )}
      {pending ? pendingLabel : children}
    </button>
  );
}

function PasswordField({
  id,
  label,
  minLength,
  lang,
}: {
  id: string;
  label: string;
  minLength?: number;
  lang: Lang;
}) {
  const t = (key: TranslationKey) => translate(lang, key);
  const [visible, setVisible] = useState(false);

  return (
    <div className="floating-label-group">
      <input
        className="floating-input pr-11"
        id={id}
        name="password"
        type={visible ? "text" : "password"}
        placeholder=" "
        required
        minLength={minLength}
      />
      <label className="floating-label" htmlFor={id}>
        {label}
      </label>
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? t("hidePassword") : t("showPassword")}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-outline hover:text-primary transition-colors"
      >
        <span className="material-symbols-outlined text-[20px]">
          {visible ? "visibility_off" : "visibility"}
        </span>
      </button>
    </div>
  );
}

export function CredentialsForm({ callbackUrl, lang }: { callbackUrl: string; lang: Lang }) {
  const t = (key: TranslationKey) => translate(lang, key);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [signInState, signInFormAction] = useActionState(
    signInAction.bind(null, callbackUrl),
    initialState,
  );
  const [signUpState, signUpFormAction] = useActionState(
    signUpAction.bind(null, callbackUrl),
    initialState,
  );

  return (
    <div className="relative z-10">
      <div className="flex bg-surface-container-low rounded-lg p-1 mb-stack-gap-md">
        <button
          type="button"
          onClick={() => setMode("signin")}
          className={
            mode === "signin"
              ? "flex-1 py-1.5 rounded-md font-label-md text-label-md bg-white shadow-sm text-primary font-semibold transition-all"
              : "flex-1 py-1.5 rounded-md font-label-md text-label-md text-on-surface-variant transition-all"
          }
        >
          {t("signIn")}
        </button>
        <button
          type="button"
          onClick={() => setMode("signup")}
          className={
            mode === "signup"
              ? "flex-1 py-1.5 rounded-md font-label-md text-label-md bg-white shadow-sm text-primary font-semibold transition-all"
              : "flex-1 py-1.5 rounded-md font-label-md text-label-md text-on-surface-variant transition-all"
          }
        >
          {t("signUp")}
        </button>
      </div>

      {mode === "signin" ? (
        <form action={signInFormAction} className="space-y-stack-gap-md">
          <div className="floating-label-group">
            <input
              className="floating-input"
              id="signin-email"
              name="email"
              type="email"
              placeholder=" "
              required
            />
            <label className="floating-label" htmlFor="signin-email">
              {t("email")}
            </label>
          </div>
          <PasswordField id="signin-password" label={t("password")} lang={lang} />
          {signInState.error && (
            <p className="font-label-sm text-label-sm text-error text-center">{signInState.error}</p>
          )}
          <SubmitButton pendingLabel={t("pleaseWait")}>{t("signIn")}</SubmitButton>
        </form>
      ) : (
        <form action={signUpFormAction} className="space-y-stack-gap-md">
          <div className="floating-label-group">
            <input
              className="floating-input"
              id="signup-name"
              name="fullName"
              type="text"
              placeholder=" "
              required
            />
            <label className="floating-label" htmlFor="signup-name">
              {t("fullName")}
            </label>
          </div>
          <div className="floating-label-group">
            <input
              className="floating-input"
              id="signup-email"
              name="email"
              type="email"
              placeholder=" "
              required
            />
            <label className="floating-label" htmlFor="signup-email">
              {t("email")}
            </label>
          </div>
          <PasswordField id="signup-password" label={t("password")} minLength={6} lang={lang} />
          {signUpState.error && (
            <p className="font-label-sm text-label-sm text-error text-center">{signUpState.error}</p>
          )}
          {signUpState.success && (
            <p className="font-label-sm text-label-sm text-primary text-center">{signUpState.success}</p>
          )}
          <SubmitButton pendingLabel={t("pleaseWait")}>{t("createAccount")}</SubmitButton>
        </form>
      )}
    </div>
  );
}
