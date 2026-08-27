"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { translate, type Lang } from "@/lib/i18n/translations";
import type { ProfileFormState } from "./actions";
import { parseJsonOrThrow, friendlyErrorMessage } from "@/lib/api-error";

type OtpPurpose = "EMAIL_CHANGE" | "PHONE_CHANGE";

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

export function InlineField({
  label,
  currentValue,
  fieldName,
  purpose,
  action,
  lang,
  inputType = "text",
}: {
  label: string;
  currentValue: string;
  fieldName: string;
  purpose: OtpPurpose;
  action: (prevState: ProfileFormState, formData: FormData) => Promise<ProfileFormState>;
  lang: Lang;
  inputType?: "text" | "email" | "tel";
}) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"input" | "otp" | "verified">("input");
  const [newValue, setNewValue] = useState(currentValue);
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, formAction] = useActionState(action, initialState);

  function close() {
    setOpen(false);
    setStep("input");
    setNewValue(currentValue);
    setCode("");
    setError(null);
  }

  async function sendCode() {
    if (!newValue.trim()) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/profile/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose, pendingValue: newValue.trim() }),
      });
      await parseJsonOrThrow(res, t("otpInvalid"));
      setStep("otp");
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
        body: JSON.stringify({ purpose, code }),
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
      <div className="flex justify-between items-center px-4 py-3 border-b border-surface-variant last:border-b-0">
        <span className="font-label-sm text-label-sm text-on-surface-variant">{label}</span>
        <div className="flex items-center gap-2">
          <span className="font-label-md text-label-md text-on-surface">{currentValue || t("notSet")}</span>
          <button
            onClick={() => setOpen(true)}
            className="p-1 text-outline hover:text-primary transition-colors"
            aria-label={label}
          >
            <span className="material-symbols-outlined text-[18px]">edit</span>
          </button>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-container-padding bg-black/50">
          <div className="w-full max-w-sm bg-white rounded-2xl p-5 shadow-xl">
            <h2 className="font-title-md text-title-md text-on-surface mb-stack-gap-md">{label}</h2>

            {step === "input" && (
              <div className="flex flex-col gap-3">
                <input
                  type={inputType}
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
                />
                {error && <p className="font-label-sm text-label-sm text-error">{error}</p>}
                <button
                  onClick={sendCode}
                  disabled={sending || !newValue.trim()}
                  className="w-full py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 disabled:opacity-60"
                >
                  {t("sendCode")}
                </button>
              </div>
            )}

            {step === "otp" && (
              <div className="flex flex-col gap-3">
                <p className="font-label-sm text-label-sm text-on-surface-variant">{t("otpSent")}</p>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder={t("enterOtpCode")}
                  className="w-full border border-outline-variant rounded-lg px-3 py-2 font-numeric-data text-numeric-data tracking-widest text-center"
                />
                {error && <p className="font-label-sm text-label-sm text-error">{error}</p>}
                <button
                  onClick={verifyCode}
                  disabled={verifying || code.length !== 6}
                  className="w-full py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 disabled:opacity-60"
                >
                  {t("verifyCode")}
                </button>
              </div>
            )}

            {step === "verified" && (
              <form action={formAction} className="flex flex-col gap-3">
                <input type="hidden" name={fieldName} value={newValue.trim()} />
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
