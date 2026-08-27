"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { translate, type Lang } from "@/lib/i18n/translations";
import { changePasswordAction, type ProfileFormState } from "./actions";
import { parseJsonOrThrow, friendlyErrorMessage } from "@/lib/api-error";

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

export function InlinePasswordField({ lang }: { lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"otp" | "verified">("otp");
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codeSent, setCodeSent] = useState(false);
  const [state, formAction] = useActionState(changePasswordAction, initialState);

  function close() {
    setOpen(false);
    setStep("otp");
    setCode("");
    setCodeSent(false);
    setError(null);
  }

  async function sendCode() {
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/profile/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "PASSWORD_CHANGE" }),
      });
      await parseJsonOrThrow(res, t("otpInvalid"));
      setCodeSent(true);
    } catch (err) {
      setError(friendlyErrorMessage(err, t("otpInvalid")));
    } finally {
      setSending(false);
    }
  }

  async function verifyCode() {
    if (code.length !== 6) return;
    setVerifying(true);
    setError(null);
    try {
      const res = await fetch("/api/profile/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "PASSWORD_CHANGE", code }),
      });
      await parseJsonOrThrow(res, t("otpInvalid"));
      setStep("verified");
    } catch (err) {
      setError(friendlyErrorMessage(err, t("otpInvalid")));
    } finally {
      setVerifying(false);
    }
  }

  if (state.success && open) {
    router.refresh();
    close();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-between px-4 py-3 bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant hover:bg-surface-container-low transition-colors"
      >
        <span className="font-label-md text-label-md text-on-surface">{t("changePassword")}</span>
        <span className="material-symbols-outlined text-outline text-[18px]">edit</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-container-padding bg-black/50">
          <div className="w-full max-w-sm bg-white rounded-2xl p-5 shadow-xl">
            <h2 className="font-title-md text-title-md text-on-surface mb-stack-gap-md">{t("changePassword")}</h2>

            {step === "otp" && (
              <div className="flex flex-col gap-3">
                {!codeSent ? (
                  <button
                    onClick={sendCode}
                    disabled={sending}
                    className="w-full py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 disabled:opacity-60"
                  >
                    {t("sendCode")}
                  </button>
                ) : (
                  <>
                    <p className="font-label-sm text-label-sm text-on-surface-variant">{t("otpSent")}</p>
                    <input
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder={t("enterOtpCode")}
                      className="w-full border border-outline-variant rounded-lg px-3 py-2 font-numeric-data text-numeric-data tracking-widest text-center"
                    />
                    <button
                      onClick={verifyCode}
                      disabled={verifying || code.length !== 6}
                      className="w-full py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 disabled:opacity-60"
                    >
                      {t("verifyCode")}
                    </button>
                  </>
                )}
                {error && <p className="font-label-sm text-label-sm text-error">{error}</p>}
              </div>
            )}

            {step === "verified" && (
              <form action={formAction} className="flex flex-col gap-3">
                <input
                  type="password"
                  name="currentPassword"
                  placeholder={t("password")}
                  required
                  className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
                />
                <input
                  type="password"
                  name="newPassword"
                  placeholder={t("password")}
                  required
                  className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
                />
                <input
                  type="password"
                  name="confirmPassword"
                  placeholder={t("password")}
                  required
                  className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
                />
                {state.error && <p className="font-label-sm text-label-sm text-error">{state.error}</p>}
                <SaveButton label={t("save")} />
              </form>
            )}

            <button
              onClick={close}
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
