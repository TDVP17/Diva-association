"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { translate, type Lang } from "@/lib/i18n/translations";
import { playUiTapSound } from "@/lib/sound-effects";

const SNOOZED_KEY = "diva_whatsapp_phone_prompt_snoozed";
const OLD_DISMISSED_KEY = "diva_whatsapp_phone_prompt_dismissed";

function WhatsAppIcon({ className = "w-6 h-6" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.456 5.711 1.457h.004c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.411Z"/>
    </svg>
  );
}

export function WhatsAppPhonePrompt({
  lang,
  hasPhone,
  userEmail = "",
}: {
  lang: Lang;
  hasPhone: boolean;
  userEmail?: string;
}) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) =>
    translate(lang, key, vars);
  const router = useRouter();

  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState<"intro" | "otp" | "success">("intro");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [maskedEmail, setMaskedEmail] = useState(userEmail);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (userEmail && !maskedEmail) {
      setMaskedEmail(userEmail);
    }
  }, [userEmail, maskedEmail]);

  // Clean up legacy permanent dismiss so users without phone get prompted when entering app
  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem(OLD_DISMISSED_KEY);
      } catch {}
    }
  }, []);

  // Show prompt when entering application if phone is missing and not snoozed this session
  useEffect(() => {
    if (hasPhone) return;

    if (typeof window !== "undefined") {
      const isSnoozed = sessionStorage.getItem(SNOOZED_KEY);
      if (!isSnoozed) {
        const handle = setTimeout(() => {
          setVisible(true);
        }, 1200);
        return () => clearTimeout(handle);
      }
    }
  }, [hasPhone]);

  // Listen to manual open requests (e.g. from banner or profile link)
  useEffect(() => {
    function handleManualOpen() {
      setError(null);
      setStep("intro");
      setVisible(true);
    }
    window.addEventListener("diva:open-phone-prompt", handleManualOpen);
    return () => window.removeEventListener("diva:open-phone-prompt", handleManualOpen);
  }, []);

  function dismiss() {
    playUiTapSound();
    if (typeof window !== "undefined") {
      try {
        sessionStorage.setItem(SNOOZED_KEY, "1");
      } catch {}
    }
    setVisible(false);
  }

  async function handleSendCode(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const cleanDigits = phone.replace(/\D/g, "");
    if (!cleanDigits || cleanDigits.length < 9) {
      setError(lang === "fr" ? "Veuillez entrer un numéro à 9 chiffres." : "Please enter a 9-digit number.");
      return;
    }

    setSending(true);
    setError(null);

    try {
      const res = await fetch("/api/profile/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purpose: "PHONE_CHANGE",
          pendingValue: cleanDigits,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || (lang === "fr" ? "Impossible d'envoyer le code." : "Could not send code."));
      }

      if (data.email) {
        setMaskedEmail(data.email);
      }
      playUiTapSound();
      setStep("otp");
    } catch (err: unknown) {
      setError((err as Error).message || (lang === "fr" ? "Une erreur est survenue." : "An error occurred."));
    } finally {
      setSending(false);
    }
  }

  async function handleVerifyAndSave(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const cleanCode = code.replace(/\D/g, "");
    if (cleanCode.length !== 6) {
      setError(lang === "fr" ? "Le code doit comporter 6 chiffres." : "Code must be 6 digits.");
      return;
    }

    setVerifying(true);
    setError(null);

    try {
      // 1. Verify OTP
      const verifyRes = await fetch("/api/profile/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purpose: "PHONE_CHANGE",
          code: cleanCode,
        }),
      });
      const verifyData = await verifyRes.json().catch(() => ({}));
      if (!verifyRes.ok) {
        throw new Error(verifyData.error || t("otpInvalid"));
      }

      // 2. Persist phone number in DB
      const cleanDigits = phone.replace(/\D/g, "");
      const saveRes = await fetch("/api/profile/phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: cleanDigits }),
      });
      const saveData = await saveRes.json().catch(() => ({}));
      if (!saveRes.ok) {
        throw new Error(saveData.error || (lang === "fr" ? "Échec de l'enregistrement." : "Failed to save phone."));
      }

      setStep("success");
      playUiTapSound();

      setTimeout(() => {
        setVisible(false);
        router.refresh();
      }, 1800);
    } catch (err: unknown) {
      setError((err as Error).message || t("otpInvalid"));
    } finally {
      setVerifying(false);
    }
  }

  if (!visible || hasPhone) return null;

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 px-container-padding backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-2xl relative border border-surface-variant overflow-hidden">
        {/* Subtle decorative gradient top bar */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-400" />

        <button
          onClick={dismiss}
          aria-label={t("close")}
          className="absolute top-3 right-3 w-9 h-9 flex items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-variant/50 transition-colors"
        >
          <span className="material-symbols-outlined text-[20px]">close</span>
        </button>

        {step === "intro" && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center gap-2.5 text-center pt-1">
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center shadow-inner">
                <WhatsAppIcon className="w-10 h-10 text-[#25D366]" />
              </div>
              <h2 className="font-headline-sm text-headline-sm text-on-surface font-bold">
                {t("whatsappPromptTitle")}
              </h2>
              <p className="font-body-md text-body-md text-on-surface-variant leading-relaxed">
                {t("whatsappPromptBody")}
              </p>
            </div>

            {/* Email verification reminder box */}
            <div className="bg-emerald-50/80 border border-emerald-200/80 rounded-xl p-3.5 flex items-start gap-3">
              <span className="material-symbols-outlined text-emerald-700 text-[22px] flex-shrink-0 mt-0.5">
                mark_email_read
              </span>
              <p className="font-label-sm text-label-sm text-emerald-900 leading-relaxed font-medium">
                {maskedEmail
                  ? t("whatsappPromptEmailNotice", { email: maskedEmail })
                  : t("whatsappPromptEmailNoticeGeneric")}
              </p>
            </div>

            <form onSubmit={handleSendCode} className="flex flex-col gap-3">
              <div>
                <label className="block font-label-sm text-label-sm text-on-surface-variant mb-1 font-semibold">
                  {t("whatsappPhoneLabel")}
                </label>
                <div className="relative flex items-center">
                  <span className="absolute left-3 text-sm font-semibold text-on-surface-variant flex items-center gap-1">
                    <span>🇨🇲</span> +237
                  </span>
                  <input
                    type="tel"
                    inputMode="tel"
                    maxLength={9}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 9))}
                    placeholder="6XXXXXXXX"
                    className="w-full border border-outline-variant rounded-xl pl-20 pr-12 py-3 font-numeric-data text-numeric-data text-base bg-white focus:outline-none focus:ring-2 focus:ring-[#25D366]/30 focus:border-[#25D366]"
                    autoFocus
                  />
                  <div className="absolute right-3 flex items-center pointer-events-none" title="WhatsApp">
                    <WhatsAppIcon className="w-6 h-6 text-[#25D366]" />
                  </div>
                </div>
              </div>

              {error && (
                <div className="p-2.5 rounded-lg bg-error-container text-on-error-container text-xs flex items-center gap-2">
                  <span className="material-symbols-outlined text-[16px]">error</span>
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={sending || phone.length < 9}
                className="w-full mt-1 py-3 px-4 rounded-xl bg-primary text-on-primary font-label-md text-label-md hover:bg-primary/95 active:scale-95 transition-all flex items-center justify-center gap-2 shadow-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {sending ? (
                  <>
                    <span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>
                    <span>{t("pleaseWait")}</span>
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[20px]">send</span>
                    <span>{t("whatsappPromptSendCode")}</span>
                  </>
                )}
              </button>
            </form>

            <div className="flex items-center justify-between pt-1">
              <Link
                href="/profile"
                onClick={dismiss}
                className="text-xs text-primary hover:underline font-medium flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[14px]">person</span>
                <span>{t("navProfile")}</span>
              </Link>
              <button
                onClick={dismiss}
                className="text-xs text-on-surface-variant hover:text-on-surface py-1 px-2 rounded font-medium"
              >
                {t("notNow")}
              </button>
            </div>
          </div>
        )}

        {step === "otp" && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center gap-2 text-center pt-1">
              <div className="w-14 h-14 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center shadow-inner">
                <span className="material-symbols-outlined text-[32px]">mark_email_unread</span>
              </div>
              <h2 className="font-headline-sm text-headline-sm text-on-surface font-bold">
                {t("whatsappPromptEnterCodeTitle")}
              </h2>
              <p className="font-body-md text-body-md text-on-surface-variant leading-relaxed">
                {t("whatsappPromptEnterCodeSubtitle", { email: maskedEmail || userEmail })}
              </p>
            </div>

            <form onSubmit={handleVerifyAndSave} className="flex flex-col gap-3">
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                className="w-full border-2 border-primary/30 rounded-xl px-4 py-3.5 text-center font-numeric-data text-numeric-data text-2xl tracking-[8px] bg-white text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                autoFocus
              />

              {error && (
                <div className="p-2.5 rounded-lg bg-error-container text-on-error-container text-xs flex items-center gap-2">
                  <span className="material-symbols-outlined text-[16px]">error</span>
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={verifying || code.length !== 6}
                className="w-full mt-1 py-3 px-4 rounded-xl bg-primary text-on-primary font-label-md text-label-md hover:bg-primary/95 active:scale-95 transition-all flex items-center justify-center gap-2 shadow-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {verifying ? (
                  <>
                    <span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>
                    <span>{t("pleaseWait")}</span>
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[20px]">verified</span>
                    <span>{t("whatsappPromptVerifyAndSave")}</span>
                  </>
                )}
              </button>
            </form>

            <div className="flex items-center justify-between pt-1 text-xs">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setCode("");
                  setStep("intro");
                }}
                className="text-primary hover:underline font-medium"
              >
                {t("whatsappPromptChangeNumber")}
              </button>
              <button
                type="button"
                onClick={() => handleSendCode()}
                disabled={sending}
                className="text-on-surface-variant hover:text-primary font-medium"
              >
                {t("whatsappPromptResendCode")}
              </button>
            </div>
          </div>
        )}

        {step === "success" && (
          <div className="flex flex-col items-center gap-3 py-6 text-center animate-in zoom-in-95 duration-200">
            <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
              <span className="material-symbols-outlined text-[40px]">check_circle</span>
            </div>
            <h2 className="font-headline-sm text-headline-sm text-emerald-800 font-bold">
              {t("whatsappPromptSuccess")}
            </h2>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Top notification banner shown to members whose WhatsApp phone number is not yet registered.
 * Displays on the member dashboard / app with a direct trigger to open the verification modal.
 */
export function WhatsAppPhoneBanner({
  lang,
  hasPhone,
  userEmail = "",
}: {
  lang: Lang;
  hasPhone: boolean;
  userEmail?: string;
}) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) =>
    translate(lang, key, vars);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setDismissed(sessionStorage.getItem("diva_whatsapp_banner_hidden") === "1");
    }
  }, []);

  if (hasPhone || dismissed) return null;

  function handleOpen() {
    playUiTapSound();
    window.dispatchEvent(new CustomEvent("diva:open-phone-prompt"));
  }

  function handleHide() {
    if (typeof window !== "undefined") {
      try {
        sessionStorage.setItem("diva_whatsapp_banner_hidden", "1");
      } catch {}
    }
    setDismissed(true);
  }

  return (
    <div className="mx-container-padding my-3 rounded-2xl bg-gradient-to-r from-amber-500 via-amber-600 to-emerald-700 text-white p-3.5 sm:p-4 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-in fade-in">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0 mt-0.5">
          <WhatsAppIcon className="w-5 h-5 text-white" />
        </div>
        <div>
          <p className="font-bold text-sm text-white">
            {t("whatsappPromptTitle")}
          </p>
          <p className="text-xs text-white/90 mt-0.5 leading-relaxed">
            {t("whatsappPromptBanner")}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 self-end sm:self-center flex-shrink-0">
        <button
          type="button"
          onClick={handleOpen}
          className="px-3.5 py-1.5 rounded-xl bg-white text-emerald-900 hover:bg-emerald-50 font-bold text-xs shadow-sm transition-transform active:scale-95"
        >
          {t("whatsappPromptBannerAction")}
        </button>
        <button
          type="button"
          onClick={handleHide}
          aria-label={t("close")}
          className="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center text-white/80 hover:text-white transition-colors"
        >
          <span className="material-symbols-outlined text-[16px]">close</span>
        </button>
      </div>
    </div>
  );
}
