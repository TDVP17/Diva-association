"use client";

import { useEffect, useRef, useState } from "react";
import { translate, type Lang, type TranslationKey } from "@/lib/i18n/translations";
import { parseJsonOrThrow, friendlyErrorMessage } from "@/lib/api-error";
import { formatXAF } from "@/lib/format-currency";
import {
  detectMobileMoneyProvider,
  getOperatorInfo,
} from "@/lib/mobile-money-provider";
import { OperatorBadge } from "@/components/operator-badge";
import { playSuccessChimeSound } from "@/lib/sound-effects";
import {
  getFapshiEdgeUrl,
  getSupabaseAccessToken,
  getSupabaseBrowserClient,
} from "@/lib/supabase/client";
import {
  NetworkFallbackProofStep,
  type FallbackPayableSlot,
} from "@/components/network-fallback-proof-step";

interface QuoteItem {
  membershipSlotId: string;
  beneficiaryName: string;
  sessionLabel: string;
  amount?: number;
  fee?: number;
  fineAmount?: number;
  baseTotal: number;
}

interface Quote {
  items: QuoteItem[];
  baseTotal: number;
  providerFeeAmount: number;
  totalCharged: number;
}

type Step = "form" | "waiting" | "success" | "failed";

/**
 * Multi-slot sibling of PaymentConfirmDialog: same form/waiting/success/
 * failed flow, but quotes and initiates a single Fapshi USSD prompt across
 * every selected membershipSlotId at once via the `bulk-quote` / `bulk`
 * actions of the `fapshi-pay` Supabase Edge Function instead of one slot at a time.
 */
export function BulkPaymentDialog({
  lang,
  membershipSlotIds,
  defaultPhone,
  isRelative = false,
  onSettled,
  onProofSubmitted,
  onClose,
}: {
  lang: Lang;
  membershipSlotIds: string[];
  defaultPhone?: string | null;
  isRelative?: boolean;
  onSettled: () => void;
  onProofSubmitted?: () => void;
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
  const [failedReason, setFailedReason] = useState<string | null>(null);
  const [failCount, setFailCount] = useState(0);
  const [showWaitingHint, setShowWaitingHint] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const channelCleanupRef = useRef<(() => void) | null>(null);
  const settledOrDoneRef = useRef(false);
  const checkingRef = useRef(false);
  const hintRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const token = await getSupabaseAccessToken();
        if (!token) {
          throw new Error(
            lang === "fr"
              ? "Votre session a expiré. Veuillez vous reconnecter."
              : "Your session expired. Please sign in again.",
          );
        }
        const res = await fetch(getFapshiEdgeUrl("bulk-quote"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ membershipSlotIds, isRelative }),
        });
        const body = await parseJsonOrThrow<Quote>(res, t("couldNotCalculateTotal"));
        if (!cancelled) setQuote(body);
      } catch (err) {
        if (!cancelled) setQuoteError(friendlyErrorMessage(err, t("couldNotCalculateTotal")));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      const res = await fetch(`${getFapshiEdgeUrl("status")}?transId=${encodeURIComponent(id)}`);
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
    const channel = supabase
      ? supabase
          .channel(`bulk-payment-status:${id}`)
          .on(
            "postgres_changes",
            {
              event: "UPDATE",
              schema: "public",
              table: "bulk_payments",
              filter: `transId=eq.${id}`,
            },
            (payload) => {
              const row = payload.new as { status?: string; failureReason?: string | null };
              if (row.status === "SUCCESSFUL" || row.status === "COMPLETED") {
                resolveTerminalStatus("SUCCESSFUL");
              } else if (row.status === "FAILED" || row.status === "EXPIRED") {
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
    const digits = phone.replace(/\D/g, "");
    const normalized = digits.startsWith("237") ? digits.slice(3) : digits;
    if (!/^[6-9]\d{8}$/.test(normalized)) {
      setPhoneError(t("invalidMobileMoneyPhone"));
      return;
    }
    const opInfo = getOperatorInfo(normalized, lang);
    if (opInfo.status === "unknown") {
      setPhoneError(
        lang === "fr"
          ? "Opérateur inconnu. Veuillez vérifier votre numéro Orange (69x, 655-659) ou MTN (67x, 680-684)."
          : "Unknown operator. Please verify your Orange or MTN Cameroon number.",
      );
      return;
    }
    setPhoneError(null);
    setSubmitting(true);
    setPayError(null);
    try {
      const token = await getSupabaseAccessToken();
      if (!token) {
        throw new Error(
          lang === "fr"
            ? "Votre session a expiré. Veuillez vous reconnecter."
            : "Your session expired. Please sign in again.",
        );
      }
      const res = await fetch(getFapshiEdgeUrl("bulk"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          membershipSlotIds,
          phone: normalized,
          isRelative,
        }),
      });
      const body = await parseJsonOrThrow<{ transId: string }>(res, t("paymentInitiationFailed"));
      setTransId(body.transId);
      setStep("waiting");
      watchPaymentStatus(body.transId);
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

  const operatorInfo = getOperatorInfo(phone, lang);
  const operatorFeeLabel =
    operatorInfo.provider === "ORANGE"
      ? lang === "fr"
        ? "Frais Orange"
        : "Orange fees"
      : operatorInfo.provider === "MTN"
        ? lang === "fr"
          ? "Frais MTN"
          : "MTN fees"
        : lang === "fr"
          ? "Frais opérateur"
          : "Operator fees";

  const providerFeeAmount =
    quote?.providerFeeAmount ??
    (quote?.baseTotal ? Math.round(quote.baseTotal * 0.031) : 0);
  const totalCharged =
    quote?.totalCharged ??
    (quote?.baseTotal ? quote.baseTotal + providerFeeAmount : 0);
  const isOperatorInvalid = operatorInfo.status === "unknown";

  const potTotal =
    quote?.items.reduce(
      (sum, item) => sum + (item.amount ?? (item.baseTotal - (item.fee ?? 100))),
      0,
    ) ?? 0;
  const feesTotal =
    quote?.items.reduce((sum, item) => sum + (item.fee ?? 100), 0) ?? 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-container-padding"
      role="dialog"
      aria-modal="true"
      onClick={step === "form" ? onClose : undefined}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-xl max-h-[90vh] overflow-y-auto"
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
              <div className="flex flex-col gap-2 mb-4 bg-surface-container-low p-3.5 rounded-xl border border-outline-variant">
                <div className="flex flex-col gap-1 max-h-32 overflow-y-auto pr-1">
                  {quote.items.map((item) => (
                    <div key={item.membershipSlotId} className="flex justify-between items-center gap-2 text-xs">
                      <span className="font-body-md text-body-md text-on-surface-variant truncate">{item.beneficiaryName}</span>
                      <span className="font-label-md text-label-md text-on-surface flex-shrink-0">{formatXAF(item.baseTotal)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between items-center text-sm pt-2 border-t border-outline-variant">
                  <span className="font-body-md text-body-md text-on-surface-variant">
                    {lang === "fr"
                      ? `Cotisation pour le pot (${quote.items.length} ${quote.items.length > 1 ? "noms" : "nom"})`
                      : `Tontine pot (${quote.items.length} ${quote.items.length > 1 ? "slots" : "slot"})`}
                  </span>
                  <span className="font-label-md text-label-md text-on-surface">{formatXAF(potTotal)}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="font-body-md text-body-md text-on-surface-variant">
                    {lang === "fr" ? "Frais Diva" : "Diva fees"}
                  </span>
                  <span className="font-label-md text-label-md text-on-surface">+{formatXAF(feesTotal)}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="font-body-md text-body-md text-on-surface-variant flex items-center gap-1.5">
                    <span>{operatorFeeLabel}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 font-semibold font-numeric-data">3,1%</span>
                  </span>
                  <span className="font-label-md text-label-md text-on-surface font-semibold text-amber-950">
                    +{formatXAF(providerFeeAmount)}
                  </span>
                </div>
                <div className="flex justify-between items-center border-t border-outline-variant pt-2.5 mt-1 bg-primary/5 -mx-3.5 -mb-3.5 p-3.5 rounded-b-xl border-t">
                  <span className="font-label-md text-sm text-on-surface font-black uppercase tracking-wider">
                    {lang === "fr" ? "TOTAL À PAYER" : "TOTAL TO PAY"}
                  </span>
                  <span className="font-headline-sm text-xl text-primary font-black">
                    {formatXAF(totalCharged)}
                  </span>
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
                  maxLength={9}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 9))}
                  placeholder={t("mobileMoneyPhonePlaceholder")}
                  className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
                />
                <OperatorBadge operator={operatorInfo} lang={lang} className="mt-2" />
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
                onClick={() => handleConfirm()}
                disabled={!quote || submitting || !phone.trim() || isOperatorInvalid}
                className="flex-1 px-3 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 active:scale-95 transition-all disabled:opacity-60"
              >
                {submitting
                  ? t("redirectingToFapshi")
                  : `${t("confirmAndPay")} (${formatXAF(totalCharged)})`}
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
                {formatXAF(totalCharged)}
              </p>
            )}
            <p className="font-label-sm text-label-sm text-on-surface-variant">{t("ussdSentToPhone", { phone })}</p>
            <p className="font-body-md text-body-md text-on-surface-variant">{t("ussdInstructions")}</p>

            {/* Operator-specific waiting tips */}
            {(() => {
              const num = phone.replace(/\D/g, "").replace(/^237/, "");
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
              <p className="font-label-sm text-label-sm text-on-surface-variant italic">{t("stillWaitingForConfirmation")}</p>
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
          const digits = phone.replace(/\D/g, "").replace(/^237/, "");
          const activeProvider = digits ? detectMobileMoneyProvider(digits) : null;
          const operatorName = activeProvider === "ORANGE" ? "Orange Money" : activeProvider === "MTN" ? "MTN MoMo" : "votre opérateur";
          const lowerReason = (failedReason || "").toLowerCase();
          const isBalance = ["balance", "solde", "fund", "fonds", "provision", "insufficient", "insuffisant"].some((k) => lowerReason.includes(k));
          const isNetworkOrOperator = !isBalance;

          if (isNetworkOrOperator) {
            const slotsForFallback: FallbackPayableSlot[] = (quote?.items ?? []).map((item) => ({
              id: item.membershipSlotId,
              beneficiaryName: item.beneficiaryName,
              baseTotal: item.baseTotal,
            }));

            return (
              <NetworkFallbackProofStep
                lang={lang}
                operatorName={operatorName}
                preferredProvider={
                  activeProvider === "ORANGE" || activeProvider === "MTN" ? activeProvider : null
                }
                failCount={failCount}
                payerPhone={phone}
                availableSlots={slotsForFallback}
                defaultSelectedSlotIds={membershipSlotIds}
                transId={transId}
                onProofSubmitted={() => {
                  if (onProofSubmitted) {
                    onProofSubmitted();
                  } else {
                    onClose();
                  }
                }}
                onClose={onClose}
              />
            );
          }

          return (
            <div className="flex flex-col items-center text-center gap-4">
              <span className="material-symbols-outlined text-error text-4xl">error</span>

              <div className="w-full text-left p-3.5 rounded-xl border border-error/40 bg-error/5 text-on-surface flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-error text-xl">
                    account_balance_wallet
                  </span>
                  <span className="font-label-md text-label-md font-bold text-on-surface">
                    {t("checkBalanceTitle")}
                  </span>
                  {failCount > 0 && (
                    <span className="ml-auto font-label-sm text-[10px] bg-black/5 text-on-surface-variant px-1.5 py-0.5 rounded-full font-medium">
                      {t("failureAttemptCount", { count: String(failCount) })}
                    </span>
                  )}
                </div>
                <p className="font-body-md text-body-md text-on-surface leading-relaxed">
                  {t("paymentFailedCheckBalance", { operator: operatorName })}
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
              {transId && <p className="font-label-sm text-[11px] text-on-surface-variant">Ref: {transId}</p>}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
