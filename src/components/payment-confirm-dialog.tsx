"use client";

import { useEffect, useRef, useState } from "react";
import { translate, type Lang, type TranslationKey } from "@/lib/i18n/translations";
import { parseJsonOrThrow, friendlyErrorMessage } from "@/lib/api-error";
import { formatXAF } from "@/lib/format-currency";
import { detectMobileMoneyProvider } from "@/lib/mobile-money-provider";
import { playSuccessChimeSound } from "@/lib/sound-effects";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  NetworkFallbackProofStep,
  type FallbackPayableSlot,
} from "@/components/network-fallback-proof-step";
import type { MobileMoneyProvider } from "@/generated/prisma/enums";

interface Quote {
  amount?: number;
  fee?: number;
  fineAmount?: number;
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
  dueDate,
  payEndpoint,
  description,
  beneficiaryName,
  fallbackAvailableSlots,
  defaultPhone,
  onSettled,
  onProofSubmitted,
  onClose,
  onDiscardDraft,
}: {
  lang: Lang;
  /** Exactly one of membershipSlotId/fineId must be set. */
  membershipSlotId?: string;
  fineId?: string;
  dueDate?: string | null;
  /** Endpoint to POST { membershipSlotId | fineId, phone } to. */
  payEndpoint: string;
  /** Shown as the payment's purpose, e.g. "Cotisation : Dimanche — 15 sept. 2026". */
  description: string;
  /** Optional display name of the slot being paid (used in fallback summary when single-slot). */
  beneficiaryName?: string;
  /** Optional list of all unpaid slots belonging to this member in the cotisation, so fallback USSD dynamically calculates total across names. */
  fallbackAvailableSlots?: FallbackPayableSlot[];
  defaultPhone?: string | null;
  /** Called once the payment is confirmed SUCCESSFUL and settled server-side. */
  onSettled: () => void;
  /** Called once the member sends fallback payment proof screenshot(s) to the admin. */
  onProofSubmitted?: () => void;
  onClose: () => void;
  /** Optional callback to discard a draft contribution. */
  onDiscardDraft?: () => void;
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
  const [failedReason, setFailedReason] = useState<string | null>(null);
  const [failCount, setFailCount] = useState(0);
  const [showWaitingHint, setShowWaitingHint] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const channelCleanupRef = useRef<(() => void) | null>(null);
  const settledOrDoneRef = useRef(false);
  const checkingRef = useRef(false);
  const hintRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
          body: JSON.stringify({
            membershipSlotId,
            ...(dueDate ? { dueDate } : {}),
          }),
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
  }, [membershipSlotId, fineId, dueDate]);

  function stopWatching() {
    if (channelCleanupRef.current) {
      channelCleanupRef.current();
      channelCleanupRef.current = null;
    }
    if (hintRef.current) {
      clearTimeout(hintRef.current);
      hintRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }

  useEffect(() => {
    return () => {
      stopWatching();
    };
  }, []);

  function resolveTerminalStatus(status: string, reason?: string | null): boolean {
    if (settledOrDoneRef.current) return true;
    if (
      status === "SUCCESSFUL" ||
      status === "COMPLETED" ||
      status === "DUPLICATE_PAID" ||
      status === "PAID"
    ) {
      settledOrDoneRef.current = true;
      stopWatching();
      playSuccessChimeSound();
      setStep("success");
      setTimeout(() => onSettled(), 1500);
      return true;
    }
    if (status === "FAILED" || status === "EXPIRED") {
      settledOrDoneRef.current = true;
      stopWatching();
      setFailedReason(reason ?? null);
      setFailCount((c) => c + 1);
      setStep("failed");
      return true;
    }
    return false;
  }

  async function checkStatusOnce(id: string): Promise<boolean> {
    if (settledOrDoneRef.current || checkingRef.current) return false;
    checkingRef.current = true;
    setCheckingStatus(true);
    try {
      const res = await fetch(`/api/payments/fapshi/status?transId=${encodeURIComponent(id)}`);
      if (!res.ok) return false;
      const body = (await res.json()) as { status: string; failureReason?: string | null };
      return resolveTerminalStatus(body.status, body.failureReason ?? null);
    } catch {
      return false;
    } finally {
      checkingRef.current = false;
      setCheckingStatus(false);
    }
  }

  // Étape 1 (STOP CPU): remplace l'ancien polling setInterval par Supabase Realtime
  function watchPaymentStatus(id: string) {
    stopWatching();
    settledOrDoneRef.current = false;
    hintRef.current = setTimeout(() => setShowWaitingHint(true), 45_000);
    // Hard timeout after 70 seconds — vérifie une seule fois auprès de Fapshi avant d'expirer
    timeoutRef.current = setTimeout(async () => {
      const resolved = await checkStatusOnce(id);
      if (!resolved && !settledOrDoneRef.current) {
        settledOrDoneRef.current = true;
        stopWatching();
        setFailedReason(t("ussdTimeoutReason"));
        setFailCount((c) => c + 1);
        setStep("failed");
      }
    }, 70_000);

    const handleVisibility = () => {
      if (document.visibilityState === "visible" && !settledOrDoneRef.current) {
        void checkStatusOnce(id);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    const supabase = getSupabaseBrowserClient();
    const targetTable = fineId ? "fines" : "contributions";
    const channel = supabase
      ? supabase
          .channel(`payment-status:${id}`)
          .on(
            "postgres_changes",
            {
              event: "UPDATE",
              schema: "public",
              table: targetTable,
              filter: `fapshiTxRef=eq.${id}`,
            },
            (payload) => {
              const row = payload.new as { status?: string; failureReason?: string | null };
              if (row.status === "PAID" || row.status === "DEDUCTED") {
                resolveTerminalStatus("PAID");
              } else if (row.status === "FAILED") {
                resolveTerminalStatus("FAILED", row.failureReason ?? null);
              }
            },
          )
          .on(
            "postgres_changes",
            {
              event: "UPDATE",
              schema: "public",
              table: "payment_attempts",
              filter: `transId=eq.${id}`,
            },
            async (payload) => {
              const row = payload.new as { status?: string };
              if (
                row.status === "SUCCESSFUL" ||
                row.status === "COMPLETED" ||
                row.status === "DUPLICATE_PAID"
              ) {
                resolveTerminalStatus("SUCCESSFUL");
              } else if (row.status === "FAILED" || row.status === "EXPIRED") {
                const resolved = await checkStatusOnce(id);
                if (!resolved) {
                  resolveTerminalStatus(row.status, null);
                }
              }
            },
          )
          .subscribe()
      : null;

    channelCleanupRef.current = () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      if (supabase && channel) {
        void supabase.removeChannel(channel);
      }
    };
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
          ...(fineId ? { fineId } : {}),
          ...(dueDate ? { dueDate } : {}),
          phone: normalized,
        }),
      });
      const body = await parseJsonOrThrow<{ transId: string }>(res, t("paymentInitiationFailed"));
      setTransId(body.transId);
      setUsedPhone(normalized);
      setStep("waiting");
      watchPaymentStatus(body.transId);
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
      setFailCount((c) => c + 1);
      setPayError(friendlyErrorMessage(err, t("paymentInitiationFailed")));
    } finally {
      setSubmitting(false);
    }
  }

  function retry() {
    stopWatching();
    setStep("form");
    setPayError(null);
    setFailedReason(null);
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
      <div
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
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
              <div className="flex flex-col gap-2 mb-4 bg-surface-container-low p-3.5 rounded-xl border border-outline-variant">
                <div className="flex justify-between items-center text-sm">
                  <span className="font-body-md text-body-md text-on-surface-variant">{t("paymentPurposeLabel")}</span>
                  <span className="font-label-md text-label-md text-on-surface font-medium text-right">{description}</span>
                </div>
                {quote.amount !== undefined && (
                  <div className="flex justify-between items-center text-sm">
                    <span className="font-body-md text-body-md text-on-surface-variant">{t("amountToContributeLabel")}</span>
                    <span className="font-label-md text-label-md text-on-surface">{formatXAF(quote.amount)}</span>
                  </div>
                )}
                {quote.fee !== undefined && quote.fee > 0 && (
                  <div className="flex justify-between items-center text-sm">
                    <span className="font-body-md text-body-md text-on-surface-variant">{t("feeLabel")}</span>
                    <span className="font-label-md text-label-md text-on-surface">+{formatXAF(quote.fee)}</span>
                  </div>
                )}
                {quote.fineAmount !== undefined && quote.fineAmount > 0 && (
                  <div className="flex justify-between items-center text-sm">
                    <span className="font-body-md text-body-md text-on-surface-variant">{t("fineDetailLabel")}</span>
                    <span className="font-label-md text-label-md text-error font-medium">+{formatXAF(quote.fineAmount)}</span>
                  </div>
                )}
                {fineId && (
                  <div className="flex justify-between items-center text-sm">
                    <span className="font-body-md text-body-md text-on-surface-variant">{t("amountLabel")}</span>
                    <span className="font-label-md text-label-md text-on-surface">{formatXAF(quote.baseTotal)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center border-t border-outline-variant pt-2 mt-1">
                  <span className="font-label-md text-label-md text-on-surface font-bold">
                    {t("totalLabel")}
                  </span>
                  <span className="font-headline-sm text-headline-sm text-primary font-bold">
                    {formatXAF(quote.baseTotal)}
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
                onClick={() => handleConfirm()}
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
              <p className="font-headline-sm text-headline-sm text-primary font-bold">
                {formatXAF(quote.baseTotal)}
              </p>
            )}
            <p className="font-label-sm text-label-sm text-on-surface-variant">
              {t("ussdSentToPhone", { phone: usedPhone })}
            </p>
            <p className="font-body-md text-body-md text-on-surface-variant">{t("ussdInstructions")}</p>

            {/* Operator-specific waiting tips */}
            {(() => {
              const num = usedPhone.replace(/\D/g, "").replace(/^237/, "");
              const p = detectMobileMoneyProvider(num);
              if (p === "MTN") {
                return (
                  <div className="w-full p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-left text-xs text-on-surface flex items-start gap-2 mt-1">
                    <span className="material-symbols-outlined text-amber-700 text-lg flex-shrink-0 mt-0.5">info</span>
                    <p className="font-medium text-amber-950 leading-relaxed">{t("mtnApprovalTip")}</p>
                  </div>
                );
              }
              if (p === "ORANGE") {
                return (
                  <div className="w-full p-3 bg-orange-500/10 border border-orange-500/30 rounded-xl text-left text-xs text-on-surface flex items-start gap-2 mt-1">
                    <span className="material-symbols-outlined text-orange-700 text-lg flex-shrink-0 mt-0.5">info</span>
                    <p className="font-medium text-orange-950 leading-relaxed">{t("orangeApprovalTip")}</p>
                  </div>
                );
              }
              return null;
            })()}

            {showWaitingHint && (
              <p className="font-label-sm text-label-sm text-on-surface-variant italic">
                {t("stillWaitingForConfirmation")}
              </p>
            )}
            {transId && (
              <button
                type="button"
                onClick={() => void checkStatusOnce(transId)}
                disabled={checkingStatus}
                className="mt-1 px-4 py-2 rounded-lg bg-primary/10 text-primary font-label-md text-label-md hover:bg-primary/15 transition-colors disabled:opacity-60"
              >
                {checkingStatus
                  ? lang === "fr"
                    ? "Vérification..."
                    : "Checking..."
                  : lang === "fr"
                    ? "J'ai validé sur mon téléphone — Vérifier"
                    : "I approved on my phone — Check status"}
              </button>
            )}
            <button
              onClick={onClose}
              className="mt-1 px-4 py-2 rounded-lg border border-outline-variant text-on-surface-variant font-label-md text-label-md hover:bg-surface-container-low"
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

        {step === "failed" && (() => {
          const rawNum = usedPhone || (usingNewNumber ? phone : (savedMethods?.find((m) => m.id === selectedMethodId)?.phone ?? ""));
          const digits = rawNum.replace(/\D/g, "").replace(/^237/, "");
          const activeProvider = digits ? detectMobileMoneyProvider(digits) : null;
          const operatorName = activeProvider === "ORANGE" ? "Orange Money" : activeProvider === "MTN" ? "MTN MoMo" : "votre opérateur";
          const lowerReason = (failedReason || "").toLowerCase();
          const isBalance = ["balance", "solde", "fund", "fonds", "provision", "insufficient", "insuffisant"].some((k) => lowerReason.includes(k));
          const isNetworkOrOperator = !isBalance;

          if (isNetworkOrOperator && !fineId) {
            const slotsForFallback: FallbackPayableSlot[] =
              fallbackAvailableSlots && fallbackAvailableSlots.length > 0
                ? fallbackAvailableSlots
                : membershipSlotId
                  ? [
                      {
                        id: membershipSlotId,
                        beneficiaryName: beneficiaryName || description,
                        baseTotal: quote?.baseTotal ?? 0,
                        dueDate: dueDate ?? null,
                      },
                    ]
                  : [];

            return (
              <NetworkFallbackProofStep
                lang={lang}
                operatorName={operatorName}
                preferredProvider={
                  activeProvider === "ORANGE" || activeProvider === "MTN" ? activeProvider : null
                }
                failCount={failCount}
                payerPhone={rawNum}
                availableSlots={slotsForFallback}
                defaultSelectedSlotIds={membershipSlotId ? [membershipSlotId] : undefined}
                transId={transId}
                onProofSubmitted={() => {
                  if (onProofSubmitted) {
                    onProofSubmitted();
                  } else {
                    onClose();
                  }
                }}
                onClose={onClose}
                onDiscardDraft={onDiscardDraft}
              />
            );
          }

          return (
            <div className="flex flex-col items-center text-center gap-4">
              <span className="material-symbols-outlined text-error text-4xl">error</span>

              {/* Error Explanation Card */}
              <div
                className={`w-full text-left p-3.5 rounded-xl border text-on-surface flex flex-col gap-2 ${
                  isBalance ? "border-error/40 bg-error/5" : "border-warning/40 bg-warning/10"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`material-symbols-outlined text-xl ${isBalance ? "text-error" : "text-warning"}`}>
                    {isBalance ? "account_balance_wallet" : "signal_wifi_off"}
                  </span>
                  <span className="font-label-md text-label-md font-bold text-on-surface">
                    {isBalance ? t("checkBalanceTitle") : t("networkUnavailableTitle")}
                  </span>
                  {failCount > 0 && (
                    <span className="ml-auto font-label-sm text-[10px] bg-black/5 text-on-surface-variant px-1.5 py-0.5 rounded-full font-medium">
                      {t("failureAttemptCount", { count: String(failCount) })}
                    </span>
                  )}
                </div>
                <p className="font-body-md text-body-md text-on-surface leading-relaxed">
                  {isBalance
                    ? t("paymentFailedCheckBalance", { operator: operatorName })
                    : t("paymentFailedOperatorNetwork", { operator: operatorName })}
                </p>
              </div>

              <div className="flex gap-3 w-full">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-3 py-2.5 rounded-lg border border-outline text-on-surface font-label-md text-label-md hover:bg-surface-variant/50 transition-colors"
                >
                  {t("cancelAction")}
                </button>
                <button
                  type="button"
                  onClick={retry}
                  className="flex-1 px-3 py-2.5 rounded-lg border border-primary text-primary font-label-md text-label-md hover:bg-primary/10 active:scale-95 transition-all"
                >
                  {t("tryAgain")}
                </button>
              </div>
              {onDiscardDraft && (
                <button
                  type="button"
                  onClick={onDiscardDraft}
                  className="text-error font-label-sm text-label-sm hover:underline flex items-center gap-1 mt-1"
                >
                  <span className="material-symbols-outlined text-[16px]">delete</span>
                  {t("deleteDraftAction")}
                </button>
              )}
              {transId && (
                <p className="font-label-sm text-[11px] text-on-surface-variant">Ref: {transId}</p>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
