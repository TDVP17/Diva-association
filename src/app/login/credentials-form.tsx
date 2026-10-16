"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  signInAction,
  signUpAction,
  requestPasswordResetAction,
  confirmPasswordResetAction,
  requestSignUpCodeAction,
  resendSignUpCodeAction,
  confirmSignUpAction,
  type AuthFormState,
} from "./actions";
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
  autoComplete,
  name = "password",
  value,
  onChange,
  required = true,
}: {
  id: string;
  label: string;
  minLength?: number;
  lang: Lang;
  autoComplete: "current-password" | "new-password";
  name?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  required?: boolean;
}) {
  const t = (key: TranslationKey) => translate(lang, key);
  const [visible, setVisible] = useState(false);

  return (
    <div className="floating-label-group">
      <input
        className="floating-input pr-11"
        id={id}
        name={name}
        type={visible ? "text" : "password"}
        placeholder=" "
        required={required}
        minLength={minLength}
        autoComplete={autoComplete}
        value={value}
        onChange={onChange}
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

export function CredentialsForm({
  callbackUrl,
  lang,
  initialMode,
}: {
  callbackUrl: string;
  lang: Lang;
  initialMode?: "signin" | "signup";
}) {
  const t = (key: TranslationKey, vars?: Record<string, string>) => translate(lang, key, vars);
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">(initialMode ?? "signin");
  const [signInState, signInFormAction] = useActionState(
    signInAction.bind(null, callbackUrl),
    initialState,
  );
  const [signUpState, signUpFormAction] = useActionState(
    signUpAction.bind(null, callbackUrl),
    initialState,
  );

  // Sign-up 2-step verification state
  const [signupStep, setSignupStep] = useState<1 | 2>(1);
  const [signupFullName, setSignupFullName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupCode, setSignupCode] = useState("");
  const [signupToken, setSignupToken] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [signupLoading, setSignupLoading] = useState(false);
  const [signupError, setSignupError] = useState<string | null>(null);
  const [signupNotice, setSignupNotice] = useState<string | null>(null);

  async function handleRequestSignupCode(e: React.FormEvent) {
    e.preventDefault();
    if (!signupFullName.trim() || !signupEmail.trim() || !signupPassword) return;
    setSignupLoading(true);
    setSignupError(null);
    setSignupNotice(null);
    try {
      const res = await requestSignUpCodeAction(
        { fullName: signupFullName, email: signupEmail, password: signupPassword },
        lang,
      );
      if (res.error) {
        setSignupError(res.error);
      } else if (res.signupToken) {
        setSignupToken(res.signupToken);
        setMaskedEmail(res.maskedEmail || signupEmail);
        setSignupStep(2);
        setSignupNotice(t("signupCodeSent"));
      }
    } catch {
      setSignupError(t("somethingWentWrong"));
    } finally {
      setSignupLoading(false);
    }
  }

  async function handleResendSignupCode() {
    if (!signupToken) return;
    setSignupLoading(true);
    setSignupError(null);
    setSignupNotice(null);
    try {
      const res = await resendSignUpCodeAction(signupToken, lang);
      if (res.error) {
        setSignupError(res.error);
      } else if (res.signupToken) {
        setSignupToken(res.signupToken);
        setSignupNotice(t("signupCodeResent"));
      }
    } catch {
      setSignupError(t("somethingWentWrong"));
    } finally {
      setSignupLoading(false);
    }
  }

  async function handleConfirmSignup(e: React.FormEvent) {
    e.preventDefault();
    if (signupCode.length !== 6) return;
    setSignupLoading(true);
    setSignupError(null);
    try {
      const res = await confirmSignUpAction(signupToken, signupCode.trim(), callbackUrl, lang);
      if (res.error) {
        setSignupError(res.error);
      }
    } catch (err) {
      if (
        typeof err === "object" &&
        err !== null &&
        "digest" in err &&
        typeof (err as { digest?: unknown }).digest === "string" &&
        (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
      ) {
        throw err;
      }
      setSignupError(t("somethingWentWrong"));
    } finally {
      setSignupLoading(false);
    }
  }

  // Forgot password state
  const [resetStep, setResetStep] = useState<1 | 2>(1);
  const [resetIdentifier, setResetIdentifier] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);
  const [resetInfo, setResetInfo] = useState<{ channel?: "EMAIL" | "WHATSAPP"; destination?: string } | null>(null);

  async function handleRequestCode(e: React.FormEvent) {
    e.preventDefault();
    if (!resetIdentifier.trim()) return;
    setResetLoading(true);
    setResetError(null);
    try {
      const res = await requestPasswordResetAction(resetIdentifier.trim(), lang);
      if (res.error) {
        setResetError(res.error);
      } else if (res.success) {
        setResetInfo({ channel: res.channel, destination: res.destination });
        setResetStep(2);
      }
    } catch {
      setResetError(t("somethingWentWrong"));
    } finally {
      setResetLoading(false);
    }
  }

  async function handleConfirmReset(e: React.FormEvent) {
    e.preventDefault();
    setResetLoading(true);
    setResetError(null);
    try {
      const res = await confirmPasswordResetAction(
        resetIdentifier.trim(),
        resetCode.trim(),
        newPassword,
        confirmPassword,
        lang,
      );
      if (res.error) {
        setResetError(res.error);
      } else if (res.success) {
        setResetSuccess(t("resetPasswordSuccess"));
        setMode("signin");
        setResetStep(1);
        setResetCode("");
        setNewPassword("");
        setConfirmPassword("");
      }
    } catch {
      setResetError(t("somethingWentWrong"));
    } finally {
      setResetLoading(false);
    }
  }

  return (
    <div className="relative z-10">
      {mode !== "forgot" && (
        <div className="flex bg-surface-container-low rounded-lg p-1 mb-stack-gap-md">
          <button
            type="button"
            onClick={() => {
              setMode("signin");
              setSignupError(null);
              setSignupNotice(null);
            }}
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
            onClick={() => {
              setMode("signup");
              setResetError(null);
              setResetSuccess(null);
            }}
            className={
              mode === "signup"
                ? "flex-1 py-1.5 rounded-md font-label-md text-label-md bg-white shadow-sm text-primary font-semibold transition-all"
                : "flex-1 py-1.5 rounded-md font-label-md text-label-md text-on-surface-variant transition-all"
            }
          >
            {t("signUp")}
          </button>
        </div>
      )}

      {resetSuccess && mode === "signin" && (
        <div className="mb-4 p-3 bg-primary/10 border border-primary/20 rounded-lg text-primary text-center font-label-sm">
          {resetSuccess}
        </div>
      )}

      {mode === "signin" ? (
        <form action={signInFormAction} className="space-y-stack-gap-md">
          <div className="floating-label-group">
            <input
              className="floating-input"
              id="signin-email"
              name="email"
              type="text"
              placeholder=" "
              required
              autoComplete="username"
              defaultValue={resetIdentifier}
            />
            <label className="floating-label" htmlFor="signin-email">
              {t("emailOrPhone")}
            </label>
          </div>
          <PasswordField id="signin-password" label={t("password")} lang={lang} autoComplete="current-password" />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => {
                setResetSuccess(null);
                setResetError(null);
                setResetStep(1);
                setMode("forgot");
              }}
              className="font-label-sm text-label-sm text-primary hover:underline transition-all"
            >
              {t("forgotPassword")}
            </button>
          </div>
          {signInState.error && (
            <p className="font-label-sm text-label-sm text-error text-center">{signInState.error}</p>
          )}
          <SubmitButton pendingLabel={t("pleaseWait")}>{t("signIn")}</SubmitButton>
        </form>
      ) : mode === "signup" ? (
        signupStep === 1 ? (
          <form onSubmit={handleRequestSignupCode} className="space-y-stack-gap-md">
            <div className="floating-label-group">
              <input
                className="floating-input"
                id="signup-name"
                name="fullName"
                type="text"
                placeholder=" "
                required
                autoComplete="name"
                value={signupFullName}
                onChange={(e) => setSignupFullName(e.target.value)}
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
                autoComplete="email"
                value={signupEmail}
                onChange={(e) => setSignupEmail(e.target.value)}
              />
              <label className="floating-label" htmlFor="signup-email">
                {t("email")}
              </label>
            </div>
            <PasswordField
              id="signup-password"
              label={t("password")}
              minLength={6}
              lang={lang}
              autoComplete="new-password"
              value={signupPassword}
              onChange={(e) => setSignupPassword(e.target.value)}
            />
            {signupError && (
              <p className="font-label-sm text-label-sm text-error text-center">{signupError}</p>
            )}
            <button
              type="submit"
              disabled={signupLoading || !signupFullName.trim() || !signupEmail.trim() || signupPassword.length < 6}
              className="w-full py-3 rounded-lg bg-primary text-on-primary font-label-md text-label-md shadow-md hover:opacity-90 active:scale-95 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {signupLoading && (
                <span
                  aria-hidden
                  className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"
                />
              )}
              {signupLoading ? t("pleaseWait") : t("createAccount")}
            </button>
          </form>
        ) : (
          <form onSubmit={handleConfirmSignup} className="space-y-stack-gap-md">
            <div className="text-center mb-2">
              <div className="w-12 h-12 rounded-full bg-primary/10 text-primary mx-auto flex items-center justify-center mb-2">
                <span className="material-symbols-outlined text-[24px]">mark_email_read</span>
              </div>
              <h3 className="font-title-md text-title-md text-on-surface font-semibold">
                {t("verifyEmailTitle")}
              </h3>
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-1 leading-relaxed">
                {t("verifyEmailSubtitle", { email: maskedEmail })}
              </p>
            </div>

            {signupNotice && (
              <div className="p-3 bg-primary/10 border border-primary/20 rounded-lg text-primary text-center font-label-sm">
                {signupNotice}
              </div>
            )}

            <div className="floating-label-group">
              <input
                className="floating-input text-center font-mono tracking-widest text-xl font-bold"
                id="signup-code"
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder=" "
                required
                autoFocus
                value={signupCode}
                onChange={(e) => setSignupCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              />
              <label className="floating-label" htmlFor="signup-code">
                {t("verifyEmailCodeLabel")}
              </label>
            </div>

            {signupError && (
              <p className="font-label-sm text-label-sm text-error text-center">{signupError}</p>
            )}

            <button
              type="submit"
              disabled={signupLoading || signupCode.length !== 6}
              className="w-full py-3 rounded-lg bg-primary text-on-primary font-label-md text-label-md shadow-md hover:opacity-90 active:scale-95 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {signupLoading && (
                <span
                  aria-hidden
                  className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"
                />
              )}
              {signupLoading ? t("pleaseWait") : t("confirmAndActivateAccount")}
            </button>

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => {
                  setSignupStep(1);
                  setSignupCode("");
                  setSignupError(null);
                  setSignupNotice(null);
                }}
                className="font-label-sm text-label-sm text-on-surface-variant hover:text-primary transition-colors flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[16px]">edit</span>
                {t("editSignupDetails")}
              </button>
              <button
                type="button"
                disabled={signupLoading}
                onClick={handleResendSignupCode}
                className="font-label-sm text-label-sm text-primary hover:underline transition-colors disabled:opacity-50"
              >
                {t("resendConfirmationCode")}
              </button>
            </div>
          </form>
        )
      ) : (
        /* mode === "forgot" */
        <div className="space-y-stack-gap-md">
          <div className="text-center mb-2">
            <h3 className="font-title-md text-title-md text-on-surface font-semibold">
              {t("forgotPasswordTitle")}
            </h3>
            {resetStep === 2 && (
              <p className="font-body-md text-body-md text-on-surface-variant mt-1">
                {resetInfo?.channel === "WHATSAPP"
                  ? t("resetCodeSentWhatsApp", { destination: resetInfo.destination ?? "" })
                  : t("resetCodeSentEmail", { destination: resetInfo?.destination ?? "" })}
              </p>
            )}
          </div>

          {resetStep === 1 ? (
            <form onSubmit={handleRequestCode} className="space-y-stack-gap-md">
              <div className="floating-label-group">
                <input
                  className="floating-input"
                  id="reset-identifier"
                  type="text"
                  placeholder=" "
                  required
                  value={resetIdentifier}
                  onChange={(e) => setResetIdentifier(e.target.value)}
                  autoComplete="username"
                />
                <label className="floating-label" htmlFor="reset-identifier">
                  {t("emailOrPhone")}
                </label>
              </div>

              {resetError && (
                <p className="font-label-sm text-label-sm text-error text-center">{resetError}</p>
              )}

              <button
                type="submit"
                disabled={resetLoading || !resetIdentifier.trim()}
                className="w-full py-3 rounded-lg bg-primary text-on-primary font-label-md text-label-md shadow-md hover:opacity-90 active:scale-95 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {resetLoading && (
                  <span
                    aria-hidden
                    className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"
                  />
                )}
                {resetLoading ? t("pleaseWait") : t("sendResetCode")}
              </button>

              <button
                type="button"
                onClick={() => setMode("signin")}
                className="w-full py-2.5 rounded-lg border border-outline-variant text-on-surface-variant font-label-md text-label-md hover:bg-surface-container-low transition-all"
              >
                {t("backToSignIn")}
              </button>
            </form>
          ) : (
            <form onSubmit={handleConfirmReset} className="space-y-stack-gap-md">
              <div className="floating-label-group">
                <input
                  className="floating-input text-center font-mono tracking-widest text-lg"
                  id="reset-code"
                  type="text"
                  maxLength={6}
                  placeholder=" "
                  required
                  value={resetCode}
                  onChange={(e) => setResetCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                />
                <label className="floating-label" htmlFor="reset-code">
                  {t("resetCodeLabel")}
                </label>
              </div>

              <PasswordField
                id="reset-new-password"
                label={t("newPasswordLabel")}
                minLength={6}
                lang={lang}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />

              <PasswordField
                id="reset-confirm-password"
                label={t("confirmNewPasswordLabel")}
                minLength={6}
                lang={lang}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />

              {resetError && (
                <p className="font-label-sm text-label-sm text-error text-center">{resetError}</p>
              )}

              <button
                type="submit"
                disabled={resetLoading || resetCode.length !== 6 || !newPassword || !confirmPassword}
                className="w-full py-3 rounded-lg bg-primary text-on-primary font-label-md text-label-md shadow-md hover:opacity-90 active:scale-95 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {resetLoading && (
                  <span
                    aria-hidden
                    className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"
                  />
                )}
                {resetLoading ? t("pleaseWait") : t("resetPasswordSubmit")}
              </button>

              <button
                type="button"
                onClick={() => setMode("signin")}
                className="w-full py-2.5 rounded-lg border border-outline-variant text-on-surface-variant font-label-md text-label-md hover:bg-surface-container-low transition-all"
              >
                {t("backToSignIn")}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
