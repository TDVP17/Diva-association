"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
import type { FallbackPaymentConfigData } from "@/lib/fallback-ussd";

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
  const router = useRouter();
  const t = (key: TranslationKey, vars?: Record<string, string>) => translate(lang, key, vars);
  const [selectedSlotIds, setSelectedSlotIds] = useState<string[]>(membershipSlotIds);
  const [allSlots, setAllSlots] = useState<QuoteItem[]>([]);
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
  const [fallbackConfig, setFallbackConfig] = useState<FallbackPaymentConfigData | null>(null);
  const [showFallbackProof, setShowFallbackProof] = useState(false);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [paymentMode, setPaymentMode] = useState<"WALLET" | "OPERATOR">("WALLET");
  const [payingWithWallet, setPayingWithWallet] = useState(false);
  const channelCleanupRef = useRef<(() => void) | null>(null);
  const settledOrDoneRef = useRef(false);
  const checkingRef = useRef(false);
  const hintRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/wallet")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { user?: { walletBalance?: number } } | null) => {
        if (!cancelled && data?.user && typeof data.user.walletBalance === "number") {
          setWalletBalance(data.user.walletBalance);
          if (data.user.walletBalance <= 0) {
            setPaymentMode("OPERATOR");
          }
        }
      })
      .catch(() => {});

    fetch("/api/payments/fallback-config")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) setFallbackConfig(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (selectedSlotIds.length === 0) {
      setQuote(null);
      return;
    }
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
          body: JSON.stringify({ membershipSlotIds: selectedSlotIds, isRelative }),
        });
        const body = await parseJsonOrThrow<Quote>(res, t("couldNotCalculateTotal"));
        if (!cancelled) {
          setQuote(body);
          setQuoteError(null);
          // Preserve full master list on initial load
          setAllSlots((prev) => (prev.length === 0 && body.items.length > 0 ? body.items : prev));
        }
      } catch (err) {
        if (!cancelled) setQuoteError(friendlyErrorMessage(err, t("couldNotCalculateTotal")));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedSlotIds, isRelative, lang]);

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
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
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
      try {
        router.refresh();
      } catch {}
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

  // Étape 1: surveillance active avec Realtime + polling actif 2.5s pour cocher les noms immédiatement
  function watchPaymentStatus(id: string) {
    stopWatching();
    settledOrDoneRef.current = false;
    hintRef.current = setTimeout(() => setShowWaitingHint(true), 45_000);

    // Polling actif toutes les 2.5s pour vérifier l'état auprès de Fapshi sans attendre
    pollRef.current = setInterval(() => {
      if (!settledOrDoneRef.current) {
        void checkStatusOnce(id);
      }
    }, 2500);

    // Hard timeout après 90 secondes — double vérification avant d'abandonner
    timeoutRef.current = setTimeout(async () => {
      const resolved = await checkStatusOnce(id);
      if (!resolved && !settledOrDoneRef.current) {
        await new Promise((r) => setTimeout(r, 1500));
        const doubleCheck = await checkStatusOnce(id);
        if (!doubleCheck && !settledOrDoneRef.current) {
          settledOrDoneRef.current = true;
          stopWatching();
          setFailedReason(t("ussdTimeoutReason"));
          setFailCount((c) => c + 1);
          setStep("failed");
        }
      }
    }, 90_000);

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

  function toggleSlot(slotId: string) {
    setSelectedSlotIds((prev) => {
      if (prev.includes(slotId)) {
        if (prev.length <= 1) return prev; // Keep at least one selected
        return prev.filter((id) => id !== slotId);
      }
      return [...prev, slotId];
    });
  }

  function selectAllSlots() {
    if (allSlots.length > 0) {
      setSelectedSlotIds(allSlots.map((s) => s.membershipSlotId));
    } else {
      setSelectedSlotIds(membershipSlotIds);
    }
  }

  async function handlePayWithWallet() {
    if (!quote || selectedSlotIds.length === 0 || payingWithWallet || submitting) return;
    setPayError(null);
    setPayingWithWallet(true);
    try {
      const res = await fetch("/api/wallet/pay-contribution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membershipSlotIds: selectedSlotIds }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPayError(data.error || "Impossible de payer avec le portefeuille.");
        return;
      }
      setPhone("Portefeuille DIVA Asso (0% frais)");
      if (data.reference) setTransId(data.reference);
      if (typeof data.newBalance === "number") setWalletBalance(data.newBalance);
      resolveTerminalStatus("SUCCESSFUL");
    } catch {
      setPayError(
        lang === "fr"
          ? "Erreur réseau lors du paiement par portefeuille."
          : "Network error during wallet payment.",
      );
    } finally {
      setPayingWithWallet(false);
    }
  }

  async function handleConfirm() {
    if (selectedSlotIds.length === 0) {
      setPayError(lang === "fr" ? "Veuillez sélectionner au moins un nom." : "Please select at least one slot.");
      return;
    }
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
    const detectedProvider = opInfo.provider;
    const isOrangeSuspended =
      detectedProvider === "ORANGE" &&
      Boolean(fallbackConfig?.isOrangeSuspended || fallbackConfig?.orangeCashInEnabled === false);
    const isMtnSuspended =
      detectedProvider === "MTN" &&
      Boolean(fallbackConfig?.isMtnSuspended || fallbackConfig?.mtnCashInEnabled === false);
    if (isOrangeSuspended || isMtnSuspended) {
      setPhoneError(
        isOrangeSuspended
          ? (fallbackConfig?.orangeCashInDisabledReason?.trim() ||
              fallbackConfig?.orangeSuspendedReason?.trim() ||
              (lang === "fr" ? "Les paiements via Orange Money sont indisponibles pour le moment." : "Orange Money payments are currently unavailable."))
          : (fallbackConfig?.mtnCashInDisabledReason?.trim() ||
              fallbackConfig?.mtnSuspendedReason?.trim() ||
              (lang === "fr" ? "Les paiements via MTN Mobile Money sont indisponibles pour le moment." : "MTN Mobile Money payments are currently unavailable."))
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
          membershipSlotIds: selectedSlotIds,
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
    setShowFallbackProof(false);
    setTransId(null);
  }

  const operatorInfo = getOperatorInfo(phone, lang);
  const detectedProvider = operatorInfo.provider;
  const isOrangeSuspended =
    detectedProvider === "ORANGE" &&
    Boolean(fallbackConfig?.isOrangeSuspended || fallbackConfig?.orangeCashInEnabled === false);
  const isMtnSuspended =
    detectedProvider === "MTN" &&
    Boolean(fallbackConfig?.isMtnSuspended || fallbackConfig?.mtnCashInEnabled === false);
  const isCurrentOperatorSuspended = isOrangeSuspended || isMtnSuspended;
  const suspendedReason = isOrangeSuspended
    ? (fallbackConfig?.orangeCashInDisabledReason?.trim() ||
        fallbackConfig?.orangeSuspendedReason?.trim() ||
        (lang === "fr"
          ? "Les paiements via Orange Money sont indisponibles pour le moment. Veuillez utiliser un numéro MTN."
          : "Orange Money payments are currently unavailable. Please use an MTN number."))
    : isMtnSuspended
    ? (fallbackConfig?.mtnCashInDisabledReason?.trim() ||
        fallbackConfig?.mtnSuspendedReason?.trim() ||
        (lang === "fr"
          ? "Les paiements via MTN Mobile Money sont indisponibles pour le moment. Veuillez utiliser un numéro Orange."
          : "MTN Mobile Money payments are currently unavailable. Please use an Orange number."))
    : null;

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

  const providerFeeAmount = quote ? Math.round(quote.baseTotal * 0.031) : 0;
  const totalCharged = quote ? quote.baseTotal + providerFeeAmount : 0;
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
              <div className="grid grid-cols-2 gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => setPaymentMode("WALLET")}
                  className={`p-2.5 rounded-xl text-xs font-bold border-2 flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    paymentMode === "WALLET"
                      ? "border-emerald-600 bg-emerald-50 text-emerald-950 shadow-xs"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <span className="material-symbols-outlined text-[17px] text-emerald-700">account_balance_wallet</span>
                  <span>Portefeuille (0% frais)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMode("OPERATOR")}
                  className={`p-2.5 rounded-xl text-xs font-bold border-2 flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    paymentMode === "OPERATOR"
                      ? "border-emerald-600 bg-emerald-50 text-emerald-950 shadow-xs"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <span className="material-symbols-outlined text-[17px] text-amber-700">phone_android</span>
                  <span>Orange / MTN Money</span>
                </button>
              </div>
            )}

            {quote && (
              <div className="flex flex-col gap-2 mb-4 bg-surface-container-low p-3.5 rounded-xl border border-outline-variant">
                <div className="flex items-center justify-between pb-1.5 border-b border-outline-variant/60">
                  <span className="text-xs font-bold text-on-surface uppercase tracking-wider">
                    {lang === "fr" ? "Noms à cotiser" : "Slots to pay"}
                  </span>
                  {(allSlots.length > 1 || (quote.items && quote.items.length > 1)) && (
                    <button
                      type="button"
                      onClick={selectAllSlots}
                      className="text-[11px] font-semibold text-primary hover:underline cursor-pointer"
                    >
                      {lang === "fr" ? "Tout cocher" : "Select all"}
                    </button>
                  )}
                </div>

                <div className="flex flex-col gap-1 max-h-40 overflow-y-auto pr-1 divide-y divide-outline-variant/30">
                  {(allSlots.length > 0 ? allSlots : quote.items).map((item) => {
                    const isChecked = selectedSlotIds.includes(item.membershipSlotId);
                    return (
                      <label
                        key={item.membershipSlotId}
                        className={`flex items-center justify-between gap-2 p-1.5 rounded-lg transition-colors cursor-pointer ${
                          isChecked ? "bg-primary/5 hover:bg-primary/10" : "opacity-60 hover:opacity-100 hover:bg-surface-container"
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleSlot(item.membershipSlotId)}
                            className="w-4 h-4 rounded text-primary focus:ring-primary cursor-pointer accent-[#064e3b]"
                          />
                          <span className="font-semibold text-xs sm:text-sm text-on-surface truncate">
                            {item.beneficiaryName}
                          </span>
                        </div>
                        <span className="font-label-md text-xs font-bold text-on-surface flex-shrink-0">
                          {formatXAF(item.baseTotal)}
                        </span>
                      </label>
                    );
                  })}
                </div>
                <div className="flex justify-between items-center text-sm pt-2 border-t border-outline-variant">
                  <span className="font-body-md text-body-md text-on-surface-variant">
                    {lang === "fr"
                      ? `Cotisation pour le pot (${selectedSlotIds.length} ${selectedSlotIds.length > 1 ? "noms" : "nom"})`
                      : `Tontine pot (${selectedSlotIds.length} ${selectedSlotIds.length > 1 ? "slots" : "slot"})`}
                  </span>
                  <span className="font-label-md text-label-md text-on-surface font-semibold">{formatXAF(potTotal)}</span>
                </div>
                {feesTotal > 0 && (
                  <div className="flex justify-between items-center text-sm">
                    <span className="font-body-md text-body-md text-on-surface-variant">
                      {lang === "fr" ? "Frais" : "Fees"}
                    </span>
                    <span className="font-label-md text-label-md text-on-surface">{formatXAF(feesTotal)}</span>
                  </div>
                )}
                {paymentMode === "WALLET" ? (
                  <div className="flex justify-between items-center text-sm">
                    <span className="font-body-md text-body-md text-on-surface-variant flex items-center gap-1.5">
                      <span>{lang === "fr" ? "Frais opérateur télécom" : "Operator telecom fees"}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-900 font-semibold font-numeric-data">0%</span>
                    </span>
                    <span className="font-label-md text-label-md text-emerald-700 font-bold">
                      0 FCFA ({lang === "fr" ? "Sans frais réseau" : "No network fee"})
                    </span>
                  </div>
                ) : (
                  <div className="flex justify-between items-center text-sm">
                    <span className="font-body-md text-body-md text-on-surface-variant flex items-center gap-1.5">
                      <span>{operatorFeeLabel}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 font-semibold font-numeric-data">3,1%</span>
                    </span>
                    <span className="font-label-md text-label-md text-on-surface font-semibold text-amber-950">
                      +{formatXAF(providerFeeAmount)}
                    </span>
                  </div>
                )}
                <div className={`flex justify-between items-center border-t border-outline-variant pt-2.5 mt-1 -mx-3.5 -mb-3.5 p-3.5 rounded-b-xl border-t ${
                  paymentMode === "WALLET" ? "bg-emerald-500/10" : "bg-primary/5"
                }`}>
                  <span className="font-label-md text-sm text-on-surface font-black uppercase tracking-wider">
                    {lang === "fr" ? "TOTAL À DÉBITER" : "TOTAL TO DEBIT"}
                  </span>
                  <span className={`font-headline-sm text-xl font-black ${
                    paymentMode === "WALLET" ? "text-emerald-900" : "text-primary"
                  }`}>
                    {paymentMode === "WALLET" ? formatXAF(quote.baseTotal) : formatXAF(totalCharged)}
                  </span>
                </div>
              </div>
            )}

            {/* A. Si mode Portefeuille sélectionné */}
            {quote && paymentMode === "WALLET" && (
              <div className="mb-4 flex flex-col gap-3">
                <div className="p-3 bg-emerald-50/80 border border-emerald-200 rounded-xl flex items-center justify-between text-xs">
                  <div>
                    <p className="font-bold text-emerald-950">
                      {lang === "fr" ? "Solde disponible sur votre Portefeuille" : "Available Wallet Balance"}
                    </p>
                    <p className="text-[11px] text-emerald-700">
                      {lang === "fr" ? "Règlement direct 0% de frais Orange/MTN" : "Direct debit 0% Orange/MTN fee"}
                    </p>
                  </div>
                  <span className="font-extrabold text-sm text-emerald-900">
                    {formatXAF(walletBalance ?? 0)}
                  </span>
                </div>

                {(walletBalance ?? 0) >= quote.baseTotal ? (
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={onClose}
                      className="flex-1 px-3 py-2.5 rounded-xl border border-outline text-on-surface text-xs font-bold hover:bg-surface-variant/50 transition-colors cursor-pointer"
                    >
                      {t("cancelAction")}
                    </button>
                    <button
                      type="button"
                      onClick={handlePayWithWallet}
                      disabled={payingWithWallet || submitting}
                      className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs sm:text-sm cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-sm transition-all"
                    >
                      {payingWithWallet ? (
                        <span>{lang === "fr" ? "Paiement en cours..." : "Processing..."}</span>
                      ) : (
                        <>
                          <span className="material-symbols-outlined text-[17px]">bolt</span>
                          <span>{lang === "fr" ? `Confirmer (${formatXAF(quote.baseTotal)})` : `Confirm (${formatXAF(quote.baseTotal)})`}</span>
                        </>
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex flex-col gap-2">
                    <p className="font-bold">
                      {lang === "fr"
                        ? `Solde portefeuille insuffisant (${formatXAF(walletBalance ?? 0)} disponibles pour ${formatXAF(quote.baseTotal)} requis).`
                        : `Insufficient wallet balance (${formatXAF(walletBalance ?? 0)} available for ${formatXAF(quote.baseTotal)} needed).`}
                    </p>
                    <p className="text-[11px] text-amber-800">
                      {lang === "fr"
                        ? "Veuillez basculer sur l'option « Orange / MTN Money » ci-dessus ou recharger votre portefeuille."
                        : "Please select Orange / MTN Money above or top up your wallet."}
                    </p>
                    <div className="flex gap-2 mt-1">
                      <button
                        type="button"
                        onClick={() => setPaymentMode("OPERATOR")}
                        className="flex-1 py-2 px-3 rounded-lg bg-amber-800 hover:bg-amber-900 text-white font-bold text-center text-xs cursor-pointer"
                      >
                        {lang === "fr" ? "Payer par Orange / MTN" : "Pay via Orange / MTN"}
                      </button>
                      <button
                        type="button"
                        onClick={onClose}
                        className="px-3 py-2 rounded-lg border border-slate-300 text-xs font-semibold cursor-pointer"
                      >
                        {t("cancelAction")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* B. Si mode Orange / MTN sélectionné */}
            {quote && paymentMode === "OPERATOR" && (
              <>
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

                  {isCurrentOperatorSuspended && (
                    <div className="w-full p-3.5 rounded-xl border-2 border-rose-500 bg-rose-50 text-rose-950 flex flex-col gap-2 mt-3 animate-in fade-in duration-150">
                      <div className="flex items-center gap-2 font-bold text-xs sm:text-sm text-rose-900">
                        <span className="material-symbols-outlined text-rose-600 text-[20px]">warning</span>
                        <span>
                          {isOrangeSuspended
                            ? (lang === "fr" ? "Paiements Orange Money temporairement suspendus" : "Orange Money payments temporarily suspended")
                            : (lang === "fr" ? "Paiements MTN MoMo temporairement suspendus" : "MTN MoMo payments temporarily suspended")}
                        </span>
                      </div>
                      <p className="text-xs text-rose-900 leading-relaxed font-semibold">
                        {suspendedReason}
                      </p>
                      <p className="text-xs text-rose-800">
                        {isOrangeSuspended
                          ? (lang === "fr" ? "Veuillez effectuer votre paiement avec un numéro MTN MoMo." : "Please complete your payment using an MTN MoMo number.")
                          : (lang === "fr" ? "Veuillez effectuer votre paiement avec un numéro Orange Money." : "Please complete your payment using an Orange Money number.")}
                      </p>
                      <div>
                        <button
                          type="button"
                          onClick={() => setPhone("")}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 active:scale-95 text-white text-xs font-bold transition-all cursor-pointer shadow-2xs"
                        >
                          <span className="material-symbols-outlined text-[15px]">swap_horiz</span>
                          <span>
                            {isOrangeSuspended
                              ? (lang === "fr" ? "Utiliser un numéro MTN" : "Use an MTN number")
                              : (lang === "fr" ? "Utiliser un numéro Orange" : "Use an Orange number")}
                          </span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={onClose}
                    className="flex-1 px-3 py-2.5 rounded-lg border border-outline text-on-surface font-label-md text-label-md hover:bg-surface-variant/50 transition-colors cursor-pointer"
                  >
                    {t("cancelAction")}
                  </button>
                  <button
                    onClick={() => handleConfirm()}
                    disabled={!quote || submitting || isCurrentOperatorSuspended || !phone.trim() || isOperatorInvalid || selectedSlotIds.length === 0}
                    className="flex-1 px-3 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 active:scale-95 transition-all disabled:opacity-60 cursor-pointer"
                  >
                    {submitting
                      ? t("redirectingToFapshi")
                      : lang === "fr"
                        ? `Cotiser (${selectedSlotIds.length} ${selectedSlotIds.length > 1 ? "noms" : "nom"} · ${formatXAF(totalCharged)})`
                        : `Pay (${selectedSlotIds.length} ${selectedSlotIds.length > 1 ? "slots" : "slot"} · ${formatXAF(totalCharged)})`}
                  </button>
                </div>
              </>
            )}
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
          <div className="flex flex-col items-center text-center gap-4 py-3 animate-in fade-in zoom-in-95 duration-200">
            <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shadow-inner">
              <span className="material-symbols-outlined text-4xl">check_circle</span>
            </div>

            <div className="flex flex-col gap-1">
              <h2 className="font-headline-sm text-xl font-bold text-on-surface">
                {lang === "fr" ? "Paiement groupé confirmé !" : "Bulk Payment Confirmed!"}
              </h2>
              <p className="font-body-sm text-xs text-on-surface-variant">
                {lang === "fr"
                  ? "Toutes vos cotisations sélectionnées ont été cochées avec succès."
                  : "All your selected cotisations have been successfully recorded."}
              </p>
            </div>

            <div className="w-full bg-surface-container-low rounded-xl p-4 border border-outline-variant/60 text-left flex flex-col gap-2.5 text-xs sm:text-sm">
              <div className="flex justify-between items-center py-1 border-b border-outline-variant/40">
                <span className="text-on-surface-variant">{lang === "fr" ? "Nombre de cotisations" : "Cotisations Count"}</span>
                <span className="font-semibold text-on-surface">{selectedSlotIds.length}</span>
              </div>
              {phone && (
                <div className="flex justify-between items-center py-1 border-b border-outline-variant/40">
                  <span className="text-on-surface-variant">{lang === "fr" ? "Numéro débité" : "Debited Phone"}</span>
                  <span className="font-mono font-semibold text-on-surface">{phone}</span>
                </div>
              )}
              {quote && (
                <div className="flex justify-between items-center py-1 pt-1.5">
                  <span className="font-medium text-on-surface">{lang === "fr" ? "Total payé" : "Total Paid"}</span>
                  <span className="font-bold text-base text-emerald-700">
                    {formatXAF(paymentMode === "WALLET" ? quote.baseTotal : (quote.totalCharged || totalCharged))}
                  </span>
                </div>
              )}
            </div>

            <div className="w-full bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 flex items-center gap-2 text-left">
              <span className="material-symbols-outlined text-emerald-700 text-lg flex-shrink-0">verified</span>
              <p className="text-[11px] text-emerald-900 leading-tight">
                {lang === "fr"
                  ? "Vos noms sont désormais cochés et les e-mails de notification ont été émis."
                  : "Your slots are now ticked and notifications have been sent."}
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                try {
                  onSettled();
                } catch {}
                onClose();
              }}
              className="w-full px-4 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-sm font-bold hover:opacity-90 active:scale-95 transition-all cursor-pointer shadow-sm mt-1"
            >
              {lang === "fr" ? "Terminer & Voir mes cotisations" : "Done & View Cotisations"}
            </button>
          </div>
        )}

        {step === "failed" && (() => {
          const digits = phone.replace(/\D/g, "").replace(/^237/, "");
          const activeProvider = digits ? detectMobileMoneyProvider(digits) : null;
          const operatorName = activeProvider === "ORANGE" ? "Orange Money" : activeProvider === "MTN" ? "MTN MoMo" : "votre opérateur";
          const oppositeOperator = activeProvider === "ORANGE" ? "MTN MoMo" : activeProvider === "MTN" ? "Orange Money" : (lang === "fr" ? "l'opérateur opposé" : "the other operator");
          const lowerReason = (failedReason || "").toLowerCase();
          const isBalance = ["balance", "solde", "fund", "fonds", "provision", "insufficient", "insuffisant"].some((k) => lowerReason.includes(k));

          if (showFallbackProof) {
            const masterList = allSlots.length > 0 ? allSlots : quote?.items ?? [];
            const slotsForFallback: FallbackPayableSlot[] = masterList.map((item) => ({
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
                defaultSelectedSlotIds={selectedSlotIds}
                transId={transId}
                onProofSubmitted={() => {
                  if (onProofSubmitted) {
                    onProofSubmitted();
                  } else {
                    onClose();
                  }
                }}
                onClose={() => setShowFallbackProof(false)}
              />
            );
          }

          const switchToOppositeOperator = () => {
            setPhone("");
            setPayError(null);
            setStep("form");
          };

          return (
            <div className="flex flex-col items-center text-center gap-4">
              <div
                className={`w-14 h-14 rounded-full flex items-center justify-center ${
                  isBalance ? "bg-rose-100 text-rose-600" : "bg-amber-100 text-amber-600"
                }`}
              >
                <span className="material-symbols-outlined text-3xl">
                  {isBalance ? "account_balance_wallet" : "error"}
                </span>
              </div>

              <div className="flex flex-col gap-1">
                <h2 className="font-headline-sm text-lg sm:text-xl font-bold text-on-surface">
                  {isBalance
                    ? (lang === "fr" ? "Solde insuffisant" : "Insufficient balance")
                    : (lang === "fr" ? "Échec du paiement" : "Payment failed")}
                </h2>
                {failCount > 0 && (
                  <span className="font-label-sm text-[11px] text-on-surface-variant font-medium">
                    {t("failureAttemptCount", { count: String(failCount) })}
                  </span>
                )}
              </div>

              <div
                className={`w-full text-left p-4 rounded-xl border text-on-surface flex flex-col gap-2.5 ${
                  isBalance ? "border-rose-300 bg-rose-50/70" : "border-amber-300 bg-amber-50/70"
                }`}
              >
                {isBalance ? (
                  <>
                    <p className="text-xs sm:text-sm text-rose-950 font-medium leading-relaxed">
                      {lang === "fr"
                        ? `Votre solde ${operatorName} est insuffisant pour effectuer ce paiement. Veuillez recharger votre compte puis réessayer.`
                        : `Your ${operatorName} balance is insufficient for this payment. Please top up your account and try again.`}
                    </p>
                    <p className="text-xs text-rose-800">
                      {lang === "fr"
                        ? `Vous pouvez également effectuer le paiement avec ${oppositeOperator} si vous disposez des fonds nécessaires.`
                        : `You can also pay with ${oppositeOperator} if you have sufficient funds with that operator.`}
                    </p>
                  </>
                ) : (
                  <div className="flex flex-col gap-2 text-xs sm:text-sm text-amber-950">
                    <p className="font-semibold text-amber-900">
                      {lang === "fr"
                        ? "Le paiement n'a pas pu aboutir. Veuillez suivre l'une de ces démarches :"
                        : "The payment could not be completed. Please follow one of these steps:"}
                    </p>
                    <ul className="flex flex-col gap-1.5 list-disc pl-4 text-xs text-amber-950">
                      <li>
                        <strong>{lang === "fr" ? "1. Consulter votre solde" : "1. Check your balance"} :</strong>{" "}
                        {lang === "fr"
                          ? `Vérifiez que votre solde ${operatorName} est bien suffisant.`
                          : `Verify that your ${operatorName} account has sufficient funds.`}
                      </li>
                      <li>
                        <strong>{lang === "fr" ? `2. Essayer avec ${oppositeOperator}` : `2. Try with ${oppositeOperator}`} :</strong>{" "}
                        {lang === "fr"
                          ? `Si le réseau de votre opérateur est indisponible, utilisez un numéro ${oppositeOperator}.`
                          : `If your operator network is unavailable, try an ${oppositeOperator} number.`}
                      </li>
                      <li>
                        <strong>{lang === "fr" ? "3. Réessayer plus tard" : "3. Try again later"} :</strong>{" "}
                        {lang === "fr"
                          ? "Le signal USSD ou réseau opérateur peut être rétabli dans un instant."
                          : "Operator USSD network prompt may be restored shortly."}
                      </li>
                    </ul>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2 w-full pt-1">
                <button
                  type="button"
                  onClick={switchToOppositeOperator}
                  className="w-full px-4 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-xs sm:text-sm font-bold hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                >
                  <span className="material-symbols-outlined text-[18px]">swap_horiz</span>
                  <span>{lang === "fr" ? `Essayer avec ${oppositeOperator}` : `Try with ${oppositeOperator}`}</span>
                </button>

                <div className="flex gap-2 w-full">
                  <button
                    type="button"
                    onClick={retry}
                    className="flex-1 px-3 py-2.5 rounded-lg border border-primary text-primary font-label-md text-xs sm:text-sm font-bold hover:bg-primary/10 active:scale-95 transition-all cursor-pointer flex items-center justify-center gap-1"
                  >
                    <span className="material-symbols-outlined text-[16px]">replay</span>
                    <span>{lang === "fr" ? "Réessayer" : "Try again"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex-1 px-3 py-2.5 rounded-lg border border-outline text-on-surface font-label-md text-xs sm:text-sm font-semibold hover:bg-surface-variant/50 transition-colors cursor-pointer"
                  >
                    {lang === "fr" ? "Réessayer plus tard" : "Try later"}
                  </button>
                </div>

                {Boolean(fallbackConfig?.isEnabled) && (
                  <button
                    type="button"
                    onClick={() => setShowFallbackProof(true)}
                    className="w-full mt-1 px-3 py-2 rounded-lg border border-amber-400 bg-amber-50 hover:bg-amber-100 text-amber-950 font-label-sm text-xs font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[16px] text-amber-700">qr_code_2</span>
                    <span>{lang === "fr" ? "Payer par code marchand / capture" : "Pay via merchant code / proof"}</span>
                  </button>
                )}
              </div>

              {transId && <p className="font-label-sm text-[11px] text-on-surface-variant">Ref: {transId}</p>}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
