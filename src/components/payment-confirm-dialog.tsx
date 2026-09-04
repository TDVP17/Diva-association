"use client";

import { useEffect, useRef, useState } from "react";
import { translate, type Lang, type TranslationKey } from "@/lib/i18n/translations";
import { parseJsonOrThrow, friendlyErrorMessage } from "@/lib/api-error";
import { formatXAF } from "@/lib/format-currency";
import { detectMobileMoneyProvider } from "@/lib/mobile-money-provider";
import type { MobileMoneyProvider } from "@/generated/prisma/enums";

interface Quote {
  baseTotal: number;
  providerFeeAmount: number;
  totalCharged: number;
}

interface SavedMethod {
  id: string;
  provider: MobileMoneyProvider;
  label: string | null;
  phone: string;
  isDefault: boolean;
}

function providerLabelKey(provider: MobileMoneyProvider): TranslationKey {
  return provider === "ORANGE" ? "orangeMoneyLabel" : "mtnMobileMoneyLabel";
}

// Fapshi rate-limits payment-status checks to 6/min per transaction — this
// interval keeps the poller comfortably under that even accounting for
// timer drift.
const POLL_INTERVAL_MS = 12_000;

type Step = "form" | "waiting" | "success" | "failed";

/**
 * Full USSD-push payment flow, shown before anything is charged: quote
 * breakdown, the Mobile Money/Orange Money number the prompt goes to, and
 * the payment's purpose — then, once confirmed, a live "waiting for you to
 * approve on your phone" screen that polls for the result. Reused by every
 * payment surface (self, relative, public, fines) via `payEndpoint` +
 * whichever of membershipSlotId/fineId applies.
 */
export function PaymentConfirmDialog({
  lang,
  membershipSlotId,
  fineId,
  payEndpoint,
  description,
  defaultPhone,
  onSettled,
  onClose,
}: {
  lang: Lang;
  /** Exactly one of membershipSlotId/fineId must be set. */
  membershipSlotId?: string;
  fineId?: string;
  /** Endpoint to POST { membershipSlotId | fineId, phone } to. */
  payEndpoint: string;
  /** Shown as the payment's purpose, e.g. "Cotisation : Dimanche — 15 sept. 2026". */
  description: string;
  defaultPhone?: string | null;
  /** Called once the payment is confirmed SUCCESSFUL and settled server-side. */
  onSettled: () => void;
  onClose: () => void;
}) {
  const t = (key: TranslationKey, vars?: Record<string, string>) => translate(lang, key, vars);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [phone, setPhone] = useState(defaultPhone ?? "");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("form");
  const [submitting, setSubmitting] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [transId, setTransId] = useState<string | null>(null);
  const [showWaitingHint, setShowWaitingHint] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hintRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // null while loading; [] once loaded (empty, or the fetch 401'd — the
  // public/anonymous pay-slot flow has no session, so this silently
  // degrades to the plain phone input below, same as it worked before this
  // feature existed).
  const [savedMethods, setSavedMethods] = useState<SavedMethod[] | null>(null);
  const [canManageSavedMethods, setCanManageSavedMethods] = useState(false);
  const [selectedMethodId, setSelectedMethodId] = useState<string>("new");
  const [saveNewNumber, setSaveNewNumber] = useState(false);
  // The phone actually sent to the payment endpoint — distinct from the
  // `phone` input state, which stays empty when a saved method (not the
  // free-text field) is what's being used.
  const [usedPhone, setUsedPhone] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/profile/payment-methods")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { methods: SavedMethod[] } | null) => {
        if (cancelled) return;
        if (!body) {
          setSavedMethods([]);
          return;
        }
        setCanManageSavedMethods(true);
        setSavedMethods(body.methods);
        const defaultMethod = body.methods.find((m) => m.isDefault);
        if (defaultMethod) setSelectedMethodId(defaultMethod.id);
      })
      .catch(() => {
        if (!cancelled) setSavedMethods([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const detectedProvider = phone.trim() ? detectMobileMoneyProvider(phone.replace(/\D/g, "").replace(/^237/, "")) : null;
  const usingNewNumber = selectedMethodId === "new" || (savedMethods?.length ?? 0) === 0;

  useEffect(() => {
    let cancelled = false;
    const request = fineId
      ? fetch(`/api/fines/${fineId}/quote`)
      : fetch("/api/payments/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ membershipSlotId }),
        });
    request
      .then(async (res) => {
        const body = await parseJsonOrThrow<Quote>(res, t("couldNotCalculateTotal"));
        if (!cancelled) setQuote(body);
      })
      .catch((err) => {
        if (!cancelled) setQuoteError(friendlyErrorMessage(err, t("couldNotCalculateTotal")));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membershipSlotId, fineId]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (hintRef.current) clearTimeout(hintRef.current);
    };
  }, []);

  function startPolling(id: string) {
    hintRef.current = setTimeout(() => setShowWaitingHint(true), 60_000);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/payments/fapshi/status?transId=${encodeURIComponent(id)}`);
        if (!res.ok) return;
        const body = (await res.json()) as { status: string; failureReason?: string | null };
        if (body.status === "SUCCESSFUL") {
          if (pollRef.current) clearInterval(pollRef.current);
          if (hintRef.current) clearTimeout(hintRef.current);
          setStep("success");
          setTimeout(() => onSettled(), 1500);
        } else if (body.status === "FAILED" || body.status === "EXPIRED") {
          if (pollRef.current) clearInterval(pollRef.current);
          if (hintRef.current) clearTimeout(hintRef.current);
          setStep("failed");
        }
      } catch {
        // Transient network hiccup — the next tick will retry.
      }
    }, POLL_INTERVAL_MS);
  }

  async function handleConfirm() {
    let normalized: string;
    if (!usingNewNumber) {
      // A saved method's phone was already validated/normalized when it was
      // saved — no need to re-run the regex against it.
      const method = savedMethods?.find((m) => m.id === selectedMethodId);
      if (!method) {
        setPhoneError(t("invalidMobileMoneyPhone"));
        return;
      }
      normalized = method.phone;
    } else {
      const digits = phone.replace(/\D/g, "");
      normalized = digits.startsWith("237") ? digits.slice(3) : digits;
      if (!/^[6-9]\d{8}$/.test(normalized)) {
        setPhoneError(t("invalidMobileMoneyPhone"));
        return;
      }
    }
    setPhoneError(null);
    setSubmitting(true);
    setPayError(null);
    try {
      const res = await fetch(payEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(membershipSlotId ? { membershipSlotId } : {}),
          phone: normalized,
        }),
      });
      const body = await parseJsonOrThrow<{ transId: string }>(res, t("paymentInitiationFailed"));
      setTransId(body.transId);
      setUsedPhone(normalized);
      setStep("waiting");
      startPolling(body.transId);
      // Best-effort, fire-and-forget — saving the number for next time is a
      // convenience, never something that should block or fail the payment
      // that's already in flight.
      if (usingNewNumber && saveNewNumber && canManageSavedMethods) {
        fetch("/api/profile/payment-methods", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone: normalized }),
        }).catch(() => {});
      }
    } catch (err) {
      setPayError(friendlyErrorMessage(err, t("paymentInitiationFailed")));
    } finally {
      setSubmitting(false);
    }
  }

  function retry() {
    setStep("form");
    setPayError(null);
    setShowWaitingHint(false);
    setTransId(null);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-container-padding"
      role="dialog"
      aria-modal="true"
      onClick={step === "form" ? onClose : undefined}
    >
      <div className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        {step === "form" && (
          <>
            <h2 className="font-headline-sm text-headline-sm text-on-surface mb-4">{t("confirmPaymentTitle")}</h2>

            {quoteError && <p className="font-label-sm text-label-sm text-error mb-4">{quoteError}</p>}
            {!quoteError && !quote && (
              <p className="font-label-sm text-label-sm text-on-surface-variant mb-4">
                {t("calculatingTotalEllipsis")}
              </p>
            )}

            {quote && (
              <div className="flex flex-col gap-2 mb-4">
                <div className="flex justify-between items-center">
                  <span className="font-body-md text-body-md text-on-surface-variant">{t("paymentPurposeLabel")}</span>
                  <span className="font-label-md text-label-md text-on-surface text-right">{description}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-body-md text-body-md text-on-surface-variant">{t("amountLabel")}</span>
                  <span className="font-label-md text-label-md text-on-surface">
                    {formatXAF(quote.baseTotal)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-body-md text-body-md text-on-surface-variant">{t("paymentFeeLabel")}</span>
                  <span className="font-label-md text-label-md text-on-surface">
                    {formatXAF(quote.providerFeeAmount)}
                  </span>
                </div>
                <div className="flex justify-between items-center border-t border-outline-variant pt-2 mt-1">
                  <span className="font-label-md text-label-md text-on-surface">{t("totalToBeDeductedLabel")}</span>
                  <span className="font-headline-sm text-headline-sm text-primary">
                    {formatXAF(quote.totalCharged)}
                  </span>
                </div>
              </div>
            )}

            {quote && (
              <div className="mb-4">
                <label className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
                  {t("mobileMoneyPhoneLabel")}
                </label>

                {savedMethods && savedMethods.length > 0 && (
                  <div className="flex flex-col gap-1.5 mb-2">
                    {savedMethods.map((m) => (
                      <label
                        key={m.id}
                        className={`flex items-center gap-2 border rounded-lg px-3 py-2 cursor-pointer transition-colors ${
                          selectedMethodId === m.id ? "border-primary bg-primary/5" : "border-outline-variant"
                        }`}
                      >
                        <input
                          type="radio"
                          name="payer-method"
                          checked={selectedMethodId === m.id}
                          onChange={() => setSelectedMethodId(m.id)}
                          className="accent-primary flex-shrink-0"
                        />
                        <span
                          className={`px-1.5 py-0.5 rounded font-label-sm text-[10px] uppercase tracking-wide flex-shrink-0 ${
                            m.provider === "ORANGE" ? "bg-orange-100 text-orange-700" : "bg-yellow-100 text-yellow-800"
                          }`}
                        >
                          {t(providerLabelKey(m.provider))}
                        </span>
                        <span className="font-label-md text-label-md text-on-surface truncate">
                          {m.label || m.phone}
                        </span>
                        {m.isDefault && (
                          <span className="ml-auto font-label-sm text-[10px] text-primary flex-shrink-0">
                            {t("defaultPayerLabel")}
                          </span>
                        )}
                      </label>
                    ))}
                    <label
                      className={`flex items-center gap-2 border rounded-lg px-3 py-2 cursor-pointer transition-colors ${
                        selectedMethodId === "new" ? "border-primary bg-primary/5" : "border-outline-variant"
                      }`}
                    >
                      <input
                        type="radio"
                        name="payer-method"
                        checked={selectedMethodId === "new"}
                        onChange={() => setSelectedMethodId("new")}
                        className="accent-primary flex-shrink-0"
                      />
                      <span className="font-label-md text-label-md text-on-surface">{t("useNewPayerNumberAction")}</span>
                    </label>
                  </div>
                )}

                {usingNewNumber && (
                  <>
                    <input
                      id="mm-phone"
                      type="tel"
                      inputMode="tel"
                      maxLength={9}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 9))}
                      placeholder={t("mobileMoneyPhonePlaceholder")}
                      className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
                    />
                    {detectedProvider && (
                      <p className="font-label-sm text-label-sm text-on-surface-variant mt-1 flex items-center gap-1">
                        <span
                          className={`px-1.5 py-0.5 rounded font-label-sm text-[10px] uppercase tracking-wide ${
                            detectedProvider === "ORANGE" ? "bg-orange-100 text-orange-700" : "bg-yellow-100 text-yellow-800"
                          }`}
                        >
                          {t(providerLabelKey(detectedProvider))}
                        </span>
                      </p>
                    )}
                    {phoneError && <p className="font-label-sm text-label-sm text-error mt-1">{phoneError}</p>}
                    {canManageSavedMethods && (
                      <label className="flex items-center gap-2 mt-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={saveNewNumber}
                          onChange={(e) => setSaveNewNumber(e.target.checked)}
                          className="accent-primary"
                        />
                        <span className="font-label-sm text-label-sm text-on-surface-variant">
                          {t("savePayerNumberAction")}
                        </span>
                      </label>
                    )}
                  </>
                )}
              </div>
            )}

            {payError && <p className="font-label-sm text-label-sm text-error mb-4">{payError}</p>}

            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 px-3 py-2.5 rounded-lg border border-outline text-on-surface font-label-md text-label-md hover:bg-surface-variant/50 transition-colors"
              >
                {t("cancelAction")}
              </button>
              <button
                onClick={handleConfirm}
                disabled={!quote || submitting || (usingNewNumber ? !phone.trim() : !selectedMethodId)}
                className="flex-1 px-3 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 active:scale-95 transition-all disabled:opacity-60"
              >
                {submitting ? t("redirectingToFapshi") : t("confirmAndPay")}
              </button>
            </div>
          </>
        )}

        {step === "waiting" && (
          <div className="flex flex-col items-center text-center gap-3">
            <span className="material-symbols-outlined text-primary text-4xl animate-pulse">smartphone</span>
            <h2 className="font-headline-sm text-headline-sm text-on-surface">{t("waitingForUssdConfirmationTitle")}</h2>
            {quote && (
              <p className="font-label-md text-label-md text-on-surface">
                {formatXAF(quote.totalCharged)}
              </p>
            )}
            <p className="font-label-sm text-label-sm text-on-surface-variant">
              {t("ussdSentToPhone", { phone: usedPhone })}
            </p>
            <p className="font-body-md text-body-md text-on-surface-variant">{t("ussdInstructions")}</p>
            {showWaitingHint && (
              <p className="font-label-sm text-label-sm text-on-surface-variant italic">
                {t("stillWaitingForConfirmation")}
              </p>
            )}
            <button
              onClick={onClose}
              className="mt-2 px-4 py-2 rounded-lg border border-outline-variant text-on-surface-variant font-label-md text-label-md hover:bg-surface-container-low"
            >
              {t("cancelAction")}
            </button>
          </div>
        )}

        {step === "success" && (
          <div className="flex flex-col items-center text-center gap-3 py-4">
            <span className="material-symbols-outlined text-primary text-5xl">check_circle</span>
            <h2 className="font-headline-sm text-headline-sm text-on-surface">{t("paymentReceivedTitle")}</h2>
          </div>
        )}

        {step === "failed" && (
          <div className="flex flex-col items-center text-center gap-4">
            <span className="material-symbols-outlined text-error text-4xl">error</span>
            <p className="font-body-md text-body-md text-on-surface">{t("paymentFailedInsufficientFunds")}</p>
            <div className="flex gap-3 w-full">
              <button
                onClick={onClose}
                className="flex-1 px-3 py-2.5 rounded-lg border border-outline text-on-surface font-label-md text-label-md hover:bg-surface-variant/50 transition-colors"
              >
                {t("cancelAction")}
              </button>
              <button
                onClick={retry}
                className="flex-1 px-3 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 active:scale-95 transition-all"
              >
                {t("tryAgain")}
              </button>
            </div>
            {transId && (
              <p className="font-label-sm text-[11px] text-on-surface-variant">Ref: {transId}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
