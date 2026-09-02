"use client";

import { useEffect, useRef, useState } from "react";
import { translate, type Lang, type TranslationKey } from "@/lib/i18n/translations";
import { parseJsonOrThrow, friendlyErrorMessage } from "@/lib/api-error";
import { formatXAF } from "@/lib/format-currency";

interface QuoteItem {
  membershipSlotId: string;
  beneficiaryName: string;
  sessionLabel: string;
  baseTotal: number;
}

interface Quote {
  items: QuoteItem[];
  baseTotal: number;
  providerFeeAmount: number;
  totalCharged: number;
}

// Same cadence as PaymentConfirmDialog — stays under Fapshi's 6/min
// payment-status rate limit per transaction.
const POLL_INTERVAL_MS = 12_000;

type Step = "form" | "waiting" | "success" | "failed";

/**
 * Multi-slot sibling of PaymentConfirmDialog: same form/waiting/success/
 * failed flow, but quotes and initiates a single Fapshi USSD prompt across
 * every selected membershipSlotId at once via the /api/payments/bulk/*
 * endpoints instead of one slot at a time.
 */
export function BulkPaymentDialog({
  lang,
  membershipSlotIds,
  defaultPhone,
  onSettled,
  onClose,
}: {
  lang: Lang;
  membershipSlotIds: string[];
  defaultPhone?: string | null;
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

  useEffect(() => {
    let cancelled = false;
    fetch("/api/payments/bulk/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ membershipSlotIds }),
    })
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
  }, []);

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
        const body = (await res.json()) as { status: string };
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
    const digits = phone.replace(/\D/g, "");
    const normalized = digits.startsWith("237") ? digits.slice(3) : digits;
    if (!/^[6-9]\d{8}$/.test(normalized)) {
      setPhoneError(t("invalidMobileMoneyPhone"));
      return;
    }
    setPhoneError(null);
    setSubmitting(true);
    setPayError(null);
    try {
      const res = await fetch("/api/payments/bulk/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membershipSlotIds, phone: normalized }),
      });
      const body = await parseJsonOrThrow<{ transId: string }>(res, t("paymentInitiationFailed"));
      setTransId(body.transId);
      setStep("waiting");
      startPolling(body.transId);
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
      <div
        className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {step === "form" && (
          <>
            <h2 className="font-headline-sm text-headline-sm text-on-surface mb-4">{t("globalPaymentConfirmTitle")}</h2>

            {quoteError && <p className="font-label-sm text-label-sm text-error mb-4">{quoteError}</p>}
            {!quoteError && !quote && (
              <p className="font-label-sm text-label-sm text-on-surface-variant mb-4">{t("calculatingTotalEllipsis")}</p>
            )}

            {quote && (
              <div className="flex flex-col gap-1 mb-4">
                {quote.items.map((item) => (
                  <div key={item.membershipSlotId} className="flex justify-between items-center gap-2">
                    <span className="font-body-md text-body-md text-on-surface-variant truncate">{item.beneficiaryName}</span>
                    <span className="font-label-md text-label-md text-on-surface flex-shrink-0">{formatXAF(item.baseTotal)}</span>
                  </div>
                ))}
                <div className="flex justify-between items-center pt-2 mt-1 border-t border-outline-variant">
                  <span className="font-body-md text-body-md text-on-surface-variant">{t("amountLabel")}</span>
                  <span className="font-label-md text-label-md text-on-surface">{formatXAF(quote.baseTotal)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-body-md text-body-md text-on-surface-variant">{t("paymentFeeLabel")}</span>
                  <span className="font-label-md text-label-md text-on-surface">{formatXAF(quote.providerFeeAmount)}</span>
                </div>
                <div className="flex justify-between items-center border-t border-outline-variant pt-2 mt-1">
                  <span className="font-label-md text-label-md text-on-surface">{t("totalToBeDeductedLabel")}</span>
                  <span className="font-headline-sm text-headline-sm text-primary">{formatXAF(quote.totalCharged)}</span>
                </div>
              </div>
            )}

            {quote && (
              <div className="mb-4">
                <label htmlFor="bulk-mm-phone" className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
                  {t("mobileMoneyPhoneLabel")}
                </label>
                <input
                  id="bulk-mm-phone"
                  type="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={t("mobileMoneyPhonePlaceholder")}
                  className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
                />
                {phoneError && <p className="font-label-sm text-label-sm text-error mt-1">{phoneError}</p>}
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
                disabled={!quote || submitting || !phone.trim()}
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
            {quote && <p className="font-label-md text-label-md text-on-surface">{formatXAF(quote.totalCharged)}</p>}
            <p className="font-label-sm text-label-sm text-on-surface-variant">{t("ussdSentToPhone", { phone })}</p>
            <p className="font-body-md text-body-md text-on-surface-variant">{t("ussdInstructions")}</p>
            {showWaitingHint && (
              <p className="font-label-sm text-label-sm text-on-surface-variant italic">{t("stillWaitingForConfirmation")}</p>
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
            {transId && <p className="font-label-sm text-[11px] text-on-surface-variant">Ref: {transId}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
