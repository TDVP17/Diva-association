"use client";

import { useEffect, useRef, useState } from "react";
import { translate, type Lang, type TranslationKey } from "@/lib/i18n/translations";
import { parseJsonOrThrow, friendlyErrorMessage } from "@/lib/api-error";
import { formatXAF } from "@/lib/format-currency";
import { detectMobileMoneyProvider } from "@/lib/mobile-money-provider";
import { playSuccessChimeSound, playUiTapSound } from "@/lib/sound-effects";
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
  dueDate,
  payEndpoint,
  description,
  defaultPhone,
  onSettled,
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
  defaultPhone?: string | null;
  /** Called once the payment is confirmed SUCCESSFUL and settled server-side. */
  onSettled: () => void;
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
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hintRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Manual payment proof upload & merchant USSD code states
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreviewUrl, setProofPreviewUrl] = useState<string | null>(null);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [proofSuccess, setProofSuccess] = useState(false);
  const [proofError, setProofError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

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

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
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
      stopPolling();
    };
  }, []);

  function startPolling(id: string) {
    stopPolling();
    hintRef.current = setTimeout(() => setShowWaitingHint(true), 45_000);
    // Hard timeout after 70 seconds to prevent indefinite loading
    timeoutRef.current = setTimeout(() => {
      stopPolling();
      setFailedReason(t("ussdTimeoutReason"));
      setFailCount((c) => c + 1);
      setStep("failed");
    }, 70_000);

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/payments/fapshi/status?transId=${encodeURIComponent(id)}`);
        if (!res.ok) return;
        const body = (await res.json()) as { status: string; failureReason?: string | null };
        if (body.status === "SUCCESSFUL" || body.status === "COMPLETED") {
          stopPolling();
          playSuccessChimeSound();
          setStep("success");
          setTimeout(() => onSettled(), 1500);
        } else if (body.status === "FAILED" || body.status === "EXPIRED") {
          stopPolling();
          setFailedReason(body.failureReason ?? null);
          setFailCount((c) => c + 1);
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
          ...(fineId ? { fineId } : {}),
          ...(dueDate ? { dueDate } : {}),
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
      setFailCount((c) => c + 1);
      setPayError(friendlyErrorMessage(err, t("paymentInitiationFailed")));
    } finally {
      setSubmitting(false);
    }
  }

  function retry() {
    stopPolling();
    setStep("form");
    setPayError(null);
    setFailedReason(null);
    setShowWaitingHint(false);
    setTransId(null);
    setProofFile(null);
    setProofPreviewUrl(null);
    setProofSuccess(false);
    setProofError(null);
    setCopiedCode(false);
  }

  function handleProofFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setProofFile(file);
    setProofError(null);
    const url = URL.createObjectURL(file);
    setProofPreviewUrl(url);
  }

  async function submitPaymentProof() {
    if (!proofFile || !membershipSlotId) return;
    setUploadingProof(true);
    setProofError(null);
    try {
      const fd = new FormData();
      fd.append("membershipSlotId", membershipSlotId);
      if (dueDate) fd.append("dueDate", dueDate);
      fd.append("phone", usedPhone || phone);
      fd.append("file", proofFile);

      const res = await fetch("/api/payments/proof", {
        method: "POST",
        body: fd,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setProofError(data?.error || t("somethingWentWrong"));
        return;
      }
      setProofSuccess(true);
    } catch {
      setProofError(t("somethingWentWrong"));
    } finally {
      setUploadingProof(false);
    }
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

        {step === "failed" && (() => {
          const rawNum = usedPhone || (usingNewNumber ? phone : (savedMethods?.find((m) => m.id === selectedMethodId)?.phone ?? ""));
          const digits = rawNum.replace(/\D/g, "").replace(/^237/, "");
          const activeProvider = digits ? detectMobileMoneyProvider(digits) : null;
          const operatorName = activeProvider === "ORANGE" ? "Orange Money" : activeProvider === "MTN" ? "MTN MoMo" : "votre opérateur";
          const lowerReason = (failedReason || "").toLowerCase();
          const isBalance = ["balance", "solde", "fund", "fonds", "provision", "insufficient", "insuffisant"].some((k) => lowerReason.includes(k));
          const isNetworkOrOperator = !isBalance;

          const targetAmount = quote?.baseTotal ?? 0;
          const merchantUssdCode = targetAmount > 0
            ? `#150*11*698416666*${targetAmount}#`
            : `#150*11*698416666#`;

          async function copyUssdCode() {
            try {
              await navigator.clipboard.writeText(merchantUssdCode);
              setCopiedCode(true);
              setTimeout(() => setCopiedCode(false), 3000);
            } catch {
              // fallback
            }
          }

          if (proofSuccess) {
            return (
              <div className="flex flex-col items-center text-center gap-4 py-2">
                <span className="material-symbols-outlined text-primary text-5xl">task_alt</span>
                <h3 className="font-headline-sm text-headline-sm text-on-surface font-bold">
                  {t("uploadPaymentProofTitle")}
                </h3>
                <div className="w-full p-4 rounded-xl border border-primary/30 bg-primary/5 text-left text-sm text-on-surface">
                  <p className="font-medium text-primary mb-2">
                    {t("proofSubmittedSuccess")}
                  </p>
                  <p className="text-xs text-on-surface-variant">
                    Réf de vérification : {membershipSlotId}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full px-4 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 transition-opacity"
                >
                  {t("finishAction")}
                </button>
              </div>
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

              {/* If network/operator issue: Provide Alternative Orange Money Merchant Payment & Proof Upload */}
              {isNetworkOrOperator && (
                <div className="w-full flex flex-col gap-3">
                  {/* Merchant USSD Code Box */}
                  <div className="w-full text-left p-3.5 rounded-xl border-2 border-orange-400 bg-orange-50/70 text-on-surface flex flex-col gap-2.5 shadow-sm">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded font-label-sm text-[11px] font-bold bg-[#FF6600] text-white">
                        Orange Money
                      </span>
                      <span className="font-label-md text-label-md font-bold text-orange-950">
                        {t("orangeMerchantCodeTitle")}
                      </span>
                    </div>

                    <p className="text-xs text-orange-900 leading-snug">
                      {t("orangeMerchantCodeDesc")}
                    </p>

                    <div className="bg-white border-2 border-orange-300 rounded-lg p-2.5 flex items-center justify-between gap-2 shadow-inner">
                      <code className="font-mono text-sm sm:text-base font-black text-orange-950 tracking-wide select-all">
                        {merchantUssdCode}
                      </code>
                      <button
                        type="button"
                        onClick={copyUssdCode}
                        className="px-2.5 py-1 rounded-md bg-orange-500 hover:bg-orange-600 active:scale-95 text-white text-xs font-bold transition-all flex items-center gap-1 flex-shrink-0 shadow-xs"
                      >
                        <span className="material-symbols-outlined text-[15px]">
                          {copiedCode ? "check" : "content_copy"}
                        </span>
                        {copiedCode ? t("ussdCodeCopied") : t("copyUssdCodeAction")}
                      </button>
                    </div>

                    <div className="bg-orange-100/60 rounded-lg p-2 text-xs text-orange-950 border border-orange-200">
                      <span className="text-orange-800 font-medium block">
                        {t("orangeMerchantBeneficiaryLabel")}
                      </span>
                      <span className="font-bold text-sm text-orange-950">
                        Valentine Parfaite Silong Diagon
                      </span>
                    </div>
                  </div>

                  {/* Screenshot Proof Upload Section */}
                  {membershipSlotId && (
                    <div className="w-full text-left p-3.5 rounded-xl border border-outline-variant bg-surface-container-lowest flex flex-col gap-2.5 shadow-xs">
                      <div className="flex items-center gap-2 text-primary">
                        <span className="material-symbols-outlined text-lg">add_a_photo</span>
                        <span className="font-label-md text-label-md font-bold text-on-surface">
                          {t("uploadPaymentProofTitle")}
                        </span>
                      </div>
                      <p className="text-xs text-on-surface-variant leading-snug">
                        {t("uploadPaymentProofDesc")}
                      </p>

                      <div className="flex flex-col gap-2">
                        <input
                          id="proof-upload-input"
                          type="file"
                          accept="image/*"
                          onChange={handleProofFileChange}
                          className="hidden"
                        />
                        <label
                          htmlFor="proof-upload-input"
                          className="w-full border-2 border-dashed border-outline-variant hover:border-primary p-3 rounded-lg text-center cursor-pointer transition-colors flex flex-col items-center gap-1 bg-surface"
                        >
                          {proofPreviewUrl ? (
                            <div className="flex items-center gap-2">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={proofPreviewUrl}
                                alt="Preuve"
                                className="w-14 h-14 object-cover rounded-md border border-outline-variant"
                              />
                              <div className="text-left">
                                <span className="font-label-sm text-xs text-primary font-bold block truncate max-w-[180px]">
                                  {proofFile?.name}
                                </span>
                                <span className="text-[11px] text-on-surface-variant">
                                  Cliquer pour changer l&apos;image
                                </span>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 text-on-surface-variant hover:text-primary">
                              <span className="material-symbols-outlined text-2xl">photo_camera</span>
                              <span className="font-label-sm text-xs font-semibold">
                                {t("chooseScreenshotAction")}
                              </span>
                            </div>
                          )}
                        </label>

                        {proofError && (
                          <p className="text-xs text-error font-medium">{proofError}</p>
                        )}

                        <button
                          type="button"
                          onClick={submitPaymentProof}
                          disabled={!proofFile || uploadingProof}
                          className="w-full py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-xs font-bold hover:opacity-90 active:scale-95 transition-all disabled:opacity-40 flex items-center justify-center gap-1.5 shadow-sm"
                        >
                          <span className="material-symbols-outlined text-[16px]">upload</span>
                          {uploadingProof ? t("proofSubmitting") : t("submitProofAction")}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

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
