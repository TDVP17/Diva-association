"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { type Lang } from "@/lib/i18n/translations";
import { formatXAF } from "@/lib/format-currency";
import { LoadingSpinner } from "@/components/loading-spinner";
import { getOperatorInfo, detectMobileMoneyProvider } from "@/lib/mobile-money-provider";
import { OperatorBadge } from "@/components/operator-badge";

interface WalletOperation {
  id: string;
  type: string;
  direction: "IN" | "OUT";
  title: string;
  subtitle: string;
  amount: number;
  formattedAmount: string;
  fee: number;
  date: string;
  timestamp: number;
  status?: string;
}

interface DisbursementMethodItem {
  id: string;
  provider: "MTN" | "ORANGE";
  phone: string;
  accountName: string;
  status: string;
}

interface WithdrawalItem {
  id: string;
  amount: number;
  phone: string;
  provider: string;
  status: string;
  requiresAdminApproval: boolean;
  rejectionReason: string | null;
  createdAt: string;
}

interface WalletClientProps {
  lang: Lang;
  initialBalance: number;
  initialTotalContributed: number;
  initialFeePercentage: number;
  isPrivateMember: boolean;
  userPhone: string | null;
  userName: string;
  userStars: number;
  operations: WalletOperation[];
  olderOperationsCount: number;
  initialHasPin: boolean;
  withdrawalLockRemainingHours: number;
  withdrawalLimits: { minAmount: number; maxAmount: number };
  operatorSuspension: {
    isOrangeSuspended: boolean;
    orangeSuspendedReason: string;
    isMtnSuspended: boolean;
    mtnSuspendedReason: string;
    orangeCashInEnabled?: boolean;
    orangeCashOutEnabled?: boolean;
    orangeCashInDisabledReason?: string;
    orangeCashOutDisabledReason?: string;
    mtnCashInEnabled?: boolean;
    mtnCashOutEnabled?: boolean;
    mtnCashInDisabledReason?: string;
    mtnCashOutDisabledReason?: string;
  };
  activeLoan: {
    id: string;
    remainingDue: number;
    dueDate: string;
    status: string;
  } | null;
  disbursementMethods: DisbursementMethodItem[];
  initialWithdrawals: WithdrawalItem[];
}

export function WalletClient({
  lang,
  initialBalance,
  initialTotalContributed,
  initialFeePercentage,
  isPrivateMember,
  userPhone,
  userStars,
  operations: initialOperations,
  olderOperationsCount,
  initialHasPin,
  withdrawalLockRemainingHours,
  withdrawalLimits,
  operatorSuspension,
  activeLoan,
  disbursementMethods,
  initialWithdrawals,
}: WalletClientProps) {
  const [balance, setBalance] = useState(initialBalance);
  const [operations, setOperations] = useState<WalletOperation[]>(initialOperations);
  const [withdrawals, setWithdrawals] = useState<WithdrawalItem[]>(initialWithdrawals);
  const [hasPin, setHasPin] = useState(initialHasPin);
  const [isBalanceHidden, setIsBalanceHidden] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);

  // Top-up modal state (string input so deleting never leaves a sticky "0")
  const [isTopUpOpen, setIsTopUpOpen] = useState(false);
  const [topUpAmountInput, setTopUpAmountInput] = useState<string>("10000");
  const topUpAmount = parseInt(topUpAmountInput, 10) || 0;
  const [phone, setPhone] = useState<string>(
    disbursementMethods[0]?.phone || userPhone || "",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [topUpMessage, setTopUpMessage] = useState<string | null>(null);
  const [topUpError, setTopUpError] = useState<string | null>(null);
  const [pollingTransId, setPollingTransId] = useState<string | null>(null);
  const [pollingSecondsLeft, setPollingSecondsLeft] = useState<number>(90);
  const [pollingState, setPollingState] = useState<"IDLE" | "POLLING" | "SUCCESS" | "FAILED">("IDLE");

  // Withdraw modal state (string input so deleting never leaves a sticky "0")
  const approvedMethods = disbursementMethods.filter((m) => m.status === "APPROVED");
  const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);
  const [withdrawAmountInput, setWithdrawAmountInput] = useState<string>("5000");
  const withdrawAmount = parseInt(withdrawAmountInput, 10) || 0;
  const [selectedMethodId, setSelectedMethodId] = useState<string>(approvedMethods[0]?.id || "");
  const [withdrawPin, setWithdrawPin] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawSuccess, setWithdrawSuccess] = useState<string | null>(null);

  // PIN modal state
  const [isPinOpen, setIsPinOpen] = useState(false);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [savingPin, setSavingPin] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinSuccess, setPinSuccess] = useState<string | null>(null);

  // Fee calculations & live operator detection for top-up + global operator suspension check
  const feeRate = initialFeePercentage / 100;
  const calculatedFee = Math.round(topUpAmount * feeRate);
  const totalDebit = topUpAmount + calculatedFee;
  const topUpOperatorInfo = getOperatorInfo(phone, lang);
  const topUpProvider = detectMobileMoneyProvider(phone.replace(/\D/g, "").replace(/^237/, ""));
  const isTopUpOperatorSuspended =
    topUpProvider === "ORANGE"
      ? Boolean(operatorSuspension.isOrangeSuspended || operatorSuspension.orangeCashInEnabled === false)
      : topUpProvider === "MTN"
        ? Boolean(operatorSuspension.isMtnSuspended || operatorSuspension.mtnCashInEnabled === false)
        : false;

  const topUpSuspendedReason =
    topUpProvider === "ORANGE"
      ? operatorSuspension.orangeCashInDisabledReason ||
        operatorSuspension.orangeSuspendedReason ||
        "Les dépôts et recharges Orange Money sont temporairement indisponibles."
      : operatorSuspension.mtnCashInDisabledReason ||
        operatorSuspension.mtnSuspendedReason ||
        "Les dépôts et recharges MTN Mobile Money sont temporairement indisponibles.";

  // Selected withdrawal method suspension check (Cash-Out)
  const selectedWithdrawMethod = approvedMethods.find((m) => m.id === selectedMethodId) || null;
  const isWithdrawOperatorSuspended =
    selectedWithdrawMethod?.provider === "ORANGE"
      ? Boolean(operatorSuspension.isOrangeSuspended || operatorSuspension.orangeCashOutEnabled === false)
      : selectedWithdrawMethod?.provider === "MTN"
        ? Boolean(operatorSuspension.isMtnSuspended || operatorSuspension.mtnCashOutEnabled === false)
        : false;

  const withdrawSuspendedReason =
    selectedWithdrawMethod?.provider === "ORANGE"
      ? operatorSuspension.orangeCashOutDisabledReason ||
        operatorSuspension.orangeSuspendedReason ||
        "Les retraits Orange Money sont temporairement suspendus par DIVA Asso. Veuillez sélectionner un autre numéro validé."
      : operatorSuspension.mtnCashOutDisabledReason ||
        operatorSuspension.mtnSuspendedReason ||
        "Les retraits MTN Mobile Money sont temporairement suspendus par DIVA Asso. Veuillez sélectionner un autre numéro validé.";

  // Live countdown ticker for active loan above Recent Operations
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!activeLoan) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [activeLoan]);

  const formatNowDateTime = () =>
    new Date().toLocaleString("fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Africa/Douala",
    });

  // Show 3 first operations by default
  const displayedOperations = isExpanded ? operations : operations.slice(0, 3);
  const hasMoreThanThree = operations.length > 3;

  // Live polling for Fapshi deposit confirmation
  useEffect(() => {
    if (!pollingTransId || pollingState !== "POLLING") return;

    let stopped = false;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/wallet/topup/status?transId=${encodeURIComponent(pollingTransId)}`);
        const data = await res.json().catch(() => null);
        if (stopped) return;

        if (data?.isSuccessful) {
          clearInterval(interval);
          setPollingState("SUCCESS");
          if (typeof data.newBalance === "number") {
            setBalance(data.newBalance);
          }
          const verifiedOp: WalletOperation = {
            id: `wtx-${pollingTransId}`,
            type: "DEPOSIT",
            direction: "IN",
            title: lang === "fr" ? "Recharge portefeuille" : "Wallet Top-up",
            subtitle: `Mobile Money · ${phone}`,
            amount: data.amount || topUpAmount,
            formattedAmount: `+ ${formatXAF(data.amount || topUpAmount)}`,
            fee: calculatedFee,
            date: formatNowDateTime(),
            timestamp: Date.now(),
            status: "SUCCESSFUL",
          };
          setOperations((prev) => [verifiedOp, ...prev.filter((op) => op.id !== verifiedOp.id)]);
          setTopUpMessage(data.message || (lang === "fr" ? "Recharge réussie avec succès !" : "Top-up successful!"));

          setTimeout(() => {
            setIsTopUpOpen(false);
            setPollingTransId(null);
            setPollingState("IDLE");
            setTopUpMessage(null);
          }, 2500);
        } else if (data?.isFailed) {
          clearInterval(interval);
          setPollingState("FAILED");
          setTopUpError(data.message || (lang === "fr" ? "Le paiement Mobile Money a été annulé ou a échoué." : "Payment cancelled or failed."));
        }
      } catch (err) {
        console.error("Top-up poll error:", err);
      }
    }, 2500);

    const countdown = setInterval(() => {
      setPollingSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(countdown);
          clearInterval(interval);
          setPollingState("FAILED");
          setTopUpError(
            lang === "fr"
              ? "Délai d'attente dépassé. Si votre compte a été débité, votre portefeuille sera crédité automatiquement dès confirmation de l'opérateur."
              : "Timeout. If charged, your wallet will be credited automatically once confirmed.",
          );
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      stopped = true;
      clearInterval(interval);
      clearInterval(countdown);
    };
  }, [pollingTransId, pollingState, phone, topUpAmount, calculatedFee, lang]);

  async function handleTopUp(e: React.FormEvent) {
    e.preventDefault();
    setTopUpError(null);
    setTopUpMessage(null);

    if (!topUpAmount || topUpAmount < 500) {
      setTopUpError(
        lang === "fr"
          ? "Le montant minimum de rechargement est de 500 FCFA."
          : "Minimum top-up amount is 500 FCFA.",
      );
      return;
    }

    if (!phone || phone.trim().length < 9) {
      setTopUpError(
        lang === "fr"
          ? "Veuillez entrer un numéro Orange Money ou MTN Mobile Money valide."
          : "Please enter a valid Orange or MTN Mobile Money number.",
      );
      return;
    }

    if (isTopUpOperatorSuspended) {
      setTopUpError(topUpSuspendedReason);
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/wallet/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: topUpAmount, phone: phone.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTopUpError(data.error || "Erreur lors du rechargement");
        setIsSubmitting(false);
        return;
      }

      // If Fapshi transaction ID returned, enter polling mode waiting for phone USSD PIN
      if (data.transId) {
        setPollingTransId(data.transId);
        setPollingSecondsLeft(90);
        setPollingState("POLLING");
        setTopUpMessage(
          data.message ||
            `Veuillez valider le débit de ${formatXAF(totalDebit)} sur votre téléphone (${phone}).`,
        );
      } else if (typeof data.newBalance === "number") {
        // Dev/Local immediate credit
        setBalance(data.newBalance);
        const newOp: WalletOperation = {
          id: `deposit-${Date.now()}`,
          type: "DEPOSIT",
          direction: "IN",
          title: lang === "fr" ? "Recharge portefeuille" : "Wallet Top-up",
          subtitle: `Mobile Money · ${phone}`,
          amount: topUpAmount,
          formattedAmount: `+ ${formatXAF(topUpAmount)}`,
          fee: calculatedFee,
          date: formatNowDateTime(),
          timestamp: Date.now(),
          status: "SUCCESSFUL",
        };
        setOperations((prev) => [newOp, ...prev]);
        setTopUpMessage(data.message || (lang === "fr" ? "Recharge réussie !" : "Top-up successful!"));

        setTimeout(() => {
          setIsTopUpOpen(false);
          setTopUpMessage(null);
        }, 2500);
      }
    } catch {
      setTopUpError(
        lang === "fr"
          ? "Erreur de connexion au serveur de paiement."
          : "Connection error with payment server.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSavePin(e: React.FormEvent) {
    e.preventDefault();
    setPinError(null);
    setPinSuccess(null);

    if (!/^\d{4}$/.test(newPin)) {
      setPinError("Le code PIN doit contenir exactement 4 chiffres.");
      return;
    }
    if (newPin !== confirmPin) {
      setPinError("Les deux codes PIN ne correspondent pas.");
      return;
    }

    setSavingPin(true);
    try {
      const res = await fetch("/api/wallet/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pin: newPin,
          ...(hasPin ? { currentPin } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPinError(data.error || "Erreur lors de l'enregistrement du PIN.");
        return;
      }
      setHasPin(true);
      setPinSuccess(data.message || "Code PIN enregistré !");
      setCurrentPin("");
      setNewPin("");
      setConfirmPin("");
      setTimeout(() => {
        setIsPinOpen(false);
        setPinSuccess(null);
      }, 1800);
    } catch {
      setPinError("Erreur réseau.");
    } finally {
      setSavingPin(false);
    }
  }

  async function handleWithdraw(e: React.FormEvent) {
    e.preventDefault();
    setWithdrawError(null);
    setWithdrawSuccess(null);

    if (!selectedMethodId) {
      setWithdrawError("Veuillez choisir un numéro de retrait validé par DIVA Asso.");
      return;
    }
    if (isWithdrawOperatorSuspended) {
      setWithdrawError(withdrawSuspendedReason);
      return;
    }
    if (balance <= 0) {
      setWithdrawError("Votre solde est à 0 FCFA. Vous ne pouvez retirer que lorsque vous avez de l'argent disponible dans votre portefeuille.");
      return;
    }
    if (!withdrawAmount || withdrawAmount < withdrawalLimits.minAmount) {
      setWithdrawError(`Le montant minimum de retrait est de ${formatXAF(withdrawalLimits.minAmount)}.`);
      return;
    }
    if (withdrawAmount > withdrawalLimits.maxAmount) {
      setWithdrawError(`Le montant maximum autorisé pour vos retraits est de ${formatXAF(withdrawalLimits.maxAmount)}.`);
      return;
    }
    if (withdrawAmount > balance) {
      setWithdrawError("Votre solde disponible est insuffisant.");
      return;
    }
    if (!/^\d{4}$/.test(withdrawPin)) {
      setWithdrawError("Veuillez saisir votre code PIN à 4 chiffres.");
      return;
    }

    setWithdrawing(true);
    try {
      const res = await fetch("/api/wallet/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: withdrawAmount,
          paymentMethodId: selectedMethodId,
          pin: withdrawPin,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setWithdrawError(data.error || "Impossible d'effectuer le retrait.");
        return;
      }

      if (typeof data.newBalance === "number") {
        setBalance(data.newBalance);
      }
      setWithdrawSuccess(data.message);
      setWithdrawPin("");

      const chosen = approvedMethods.find((m) => m.id === selectedMethodId);
      if (chosen) {
        setWithdrawals((prev) => [
          {
            id: data.withdrawalId || `w-${Date.now()}`,
            amount: withdrawAmount,
            phone: chosen.phone,
            provider: chosen.provider,
            status: data.status || "COMPLETED",
            requiresAdminApproval: Boolean(data.requiresAdminApproval),
            rejectionReason: null,
            createdAt: new Date().toISOString(),
          },
          ...prev,
        ]);

        setOperations((prev) => [
          {
            id: `wop-${Date.now()}`,
            type: "WITHDRAWAL",
            direction: "OUT",
            title: data.requiresAdminApproval ? "Retrait (en attente Admin)" : "Retrait effectué",
            subtitle: `${chosen.provider} · ${chosen.phone} (0% frais)`,
            amount: withdrawAmount,
            formattedAmount: `- ${formatXAF(withdrawAmount)}`,
            fee: 0,
            date: formatNowDateTime(),
            timestamp: Date.now(),
          },
          ...prev,
        ]);
      }

      setTimeout(() => {
        setIsWithdrawOpen(false);
        setWithdrawSuccess(null);
      }, 2800);
    } catch {
      setWithdrawError("Erreur réseau lors de la demande de retrait.");
    } finally {
      setWithdrawing(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 max-w-xl mx-auto w-full pb-24 px-4 sm:px-0">
      {/* ── En-tête de la page ── */}
      <div className="flex items-center justify-between pt-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
            {lang === "fr" ? "Mon portefeuille" : "My Wallet"}
          </h1>
          <p className="text-[11px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider mt-0.5">
            {lang === "fr" ? "Vue générale de vos finances" : "General overview of your finances"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsPinOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-emerald-50 text-emerald-900 border border-emerald-200/80 text-xs font-bold hover:bg-emerald-100 transition-colors cursor-pointer"
          title="Sécurité Code PIN"
        >
          <span className="material-symbols-outlined text-[18px]">pin</span>
          <span>{hasPin ? "PIN actif" : "Définir PIN"}</span>
        </button>
      </div>

      {/* ── Carte principale du solde (Vert Foncé DIVA Asso) ── */}
      <div className="bg-[#0b3d2e] rounded-2xl p-4 sm:p-5 text-white shadow-lg relative overflow-hidden flex flex-col gap-3 border border-emerald-900/40">
        <div className="absolute -right-8 -top-8 w-28 h-28 rounded-full bg-emerald-500/10 blur-xl pointer-events-none" />
        <div className="absolute -left-8 -bottom-8 w-24 h-24 rounded-full bg-emerald-400/10 blur-lg pointer-events-none" />

        <div className="flex items-center justify-between relative z-10">
          <div>
            <span className="text-[11px] sm:text-xs font-medium text-emerald-200/90 tracking-wide block">
              {lang === "fr" ? "Solde disponible" : "Available balance"}
            </span>
            <p className="text-2xl sm:text-3xl font-extrabold tracking-tight mt-0.5">
              {isBalanceHidden ? "•••••• FCFA" : formatXAF(balance)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsBalanceHidden((prev) => !prev)}
            className="p-1.5 rounded-full hover:bg-white/10 text-emerald-200 transition-colors cursor-pointer self-start"
            title={isBalanceHidden ? "Afficher le solde" : "Masquer le solde"}
          >
            <span className="material-symbols-outlined text-[20px]">
              {isBalanceHidden ? "visibility_off" : "visibility"}
            </span>
          </button>
        </div>

        {/* Actions: Recharger + Retirer côte à côte sur 1 seule ligne */}
        <div className="relative z-10 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setIsTopUpOpen(true)}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-white text-emerald-950 font-bold text-xs hover:bg-emerald-50 active:scale-95 transition-all shadow-sm cursor-pointer whitespace-nowrap"
          >
            <span className="material-symbols-outlined text-[16px] text-emerald-800">add_circle</span>
            <span>{lang === "fr" ? "Recharger" : "Top up"}</span>
          </button>
          <button
            type="button"
            onClick={() => setIsWithdrawOpen(true)}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600/40 hover:bg-emerald-600/60 text-white border border-emerald-300/30 font-bold text-xs active:scale-95 transition-all cursor-pointer whitespace-nowrap"
          >
            <span className="material-symbols-outlined text-[16px]">payments</span>
            <span>{lang === "fr" ? "Retirer" : "Withdraw"}</span>
          </button>
        </div>
      </div>

      {/* ── Retraits en attente de validation Admin ── */}
      {withdrawals.some((w) => w.status === "PENDING_ADMIN") && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-amber-900 font-bold text-xs">
            <span className="material-symbols-outlined text-[18px]">hourglass_top</span>
            <span>Retraits en attente de validation Admin</span>
          </div>
          {withdrawals
            .filter((w) => w.status === "PENDING_ADMIN")
            .map((w) => (
              <div
                key={w.id}
                className="flex items-center justify-between text-xs bg-white/80 rounded-xl px-3 py-2 border border-amber-100"
              >
                <span className="font-semibold text-slate-800">
                  {w.provider} · {w.phone}
                </span>
                <span className="font-extrabold text-amber-900">{formatXAF(w.amount)}</span>
              </div>
            ))}
        </div>
      )}

      {/* ── Compte à rebours Prêt actif (en haut des Opérations récentes) ── */}
      {activeLoan && (() => {
        const dueMs = new Date(activeLoan.dueDate).getTime();
        const remainingMs = Math.max(0, dueMs - nowTick);
        const days = Math.floor(remainingMs / (24 * 60 * 60 * 1000));
        const hours = Math.floor((remainingMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
        const mins = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
        const secs = Math.floor((remainingMs % (60 * 1000)) / 1000);
        const isOverdue = activeLoan.status === "OVERDUE" || remainingMs === 0;
        const dueLabel = new Date(activeLoan.dueDate).toLocaleDateString("fr-FR", {
          day: "numeric",
          month: "short",
          year: "numeric",
          timeZone: "Africa/Douala",
        });

        return (
          <div
            className={`rounded-2xl p-4 border-2 shadow-xs flex flex-col gap-2.5 ${
              isOverdue
                ? "bg-red-50 border-red-300"
                : "bg-amber-50/70 border-amber-300"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <span
                  className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                    isOverdue ? "bg-red-600 text-white" : "bg-amber-200 text-amber-950"
                  }`}
                >
                  {isOverdue ? "Prêt en retard" : "Prêt en cours · Compte à rebours"}
                </span>
                <p className="text-sm font-extrabold text-slate-900 mt-1">
                  À rembourser : {formatXAF(activeLoan.remainingDue)}
                </p>
                <p className="text-[11px] text-slate-600">
                  Date limite : <strong>{dueLabel} à 18h00</strong>
                </p>
              </div>
              <div className="bg-slate-900 text-white rounded-xl px-2.5 py-1.5 text-right flex-shrink-0">
                <span className="text-[9px] uppercase text-emerald-300 block font-bold">Reste</span>
                <span className="font-mono text-xs font-extrabold">
                  {days}j {String(hours).padStart(2, "0")}h {String(mins).padStart(2, "0")}m {String(secs).padStart(2, "0")}s
                </span>
              </div>
            </div>
            <Link
              href="/loans"
              className="w-full py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs text-center transition-colors"
            >
              Rembourser mon prêt (Portefeuille ou OM/MTN)
            </Link>
          </div>
        );
      })()}

      {/* ── Section Opérations Récentes (Historique 1 mois) ── */}
      <div className="bg-white rounded-3xl p-5 sm:p-6 shadow-sm border border-slate-200/80 flex flex-col gap-4">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900">
            {lang === "fr" ? "Opérations récentes" : "Recent operations"}
          </h2>
          <span className="text-[11px] font-semibold text-slate-400">
            {lang === "fr" ? "30 derniers jours" : "Last 30 days"}
          </span>
        </div>

        {operations.length === 0 ? (
          <div className="py-8 text-center flex flex-col items-center justify-center gap-2 text-slate-400">
            <span className="material-symbols-outlined text-4xl text-slate-300">receipt_long</span>
            <p className="text-xs font-medium text-slate-500">
              {lang === "fr"
                ? "Aucune opération récente ce mois-ci."
                : "No recent transactions this month."}
            </p>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-slate-100">
            {displayedOperations.map((op) => {
              const isCredit = op.direction === "IN";
              return (
                <div
                  key={op.id}
                  className="py-3.5 flex items-center justify-between gap-3 first:pt-1 last:pb-1"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-2xl flex items-center justify-center flex-shrink-0 ${
                        isCredit ? "bg-emerald-100 text-emerald-800" : "bg-red-50 text-red-600"
                      }`}
                    >
                      <span className="material-symbols-outlined text-[18px]">
                        {isCredit ? "south_west" : "north_east"}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs sm:text-sm font-bold text-slate-900 truncate">
                        {op.title}
                      </p>
                      <p className="text-[11px] text-slate-500 truncate mt-0.5">
                        {op.subtitle} · {op.date}
                      </p>
                    </div>
                  </div>

                  <div className="text-right flex-shrink-0">
                    <span
                      className={`text-xs sm:text-sm font-extrabold font-mono ${
                        isCredit ? "text-emerald-700" : "text-red-600"
                      }`}
                    >
                      {op.formattedAmount}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {hasMoreThanThree && (
          <div className="pt-2 flex flex-col items-center justify-center">
            <button
              type="button"
              onClick={() => setIsExpanded((prev) => !prev)}
              className="w-10 h-10 rounded-full border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 flex items-center justify-center transition-all active:scale-95 cursor-pointer shadow-2xs"
              title={isExpanded ? "Réduire" : "Voir plus"}
            >
              <span
                className={`material-symbols-outlined text-[22px] transition-transform duration-200 ${
                  isExpanded ? "rotate-180" : ""
                }`}
              >
                keyboard_arrow_down
              </span>
            </button>
            <span className="text-[10px] text-slate-400 font-medium mt-1">
              {isExpanded
                ? lang === "fr"
                  ? "Réduire"
                  : "Show less"
                : lang === "fr"
                  ? "Voir plus"
                  : "See more"}
            </span>
          </div>
        )}

        {olderOperationsCount > 0 && (
          <div className="mt-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200/60 text-[11px] text-slate-500 flex items-center gap-2">
            <span className="material-symbols-outlined text-slate-400 text-[16px]">inventory_2</span>
            <span>
              {lang === "fr"
                ? `${olderOperationsCount} opération(s) de plus d'un mois archivée(s) et conservée(s) chez l'administrateur.`
                : `${olderOperationsCount} transaction(s) older than 1 month archived and secured with admin.`}
            </span>
          </div>
        )}
      </div>

      {/* ── Accès rapide Prêt d'Urgence Garanti (en bas des opérations récentes) ── */}
      <Link
        href="/loans"
        className="bg-gradient-to-r from-amber-50 to-emerald-50 rounded-2xl p-4 border border-amber-200/80 flex items-center justify-between gap-3 hover:shadow-md transition-all"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-[22px]">workspace_premium</span>
          </div>
          <div>
            <p className="text-xs sm:text-sm font-extrabold text-slate-900">
              {lang === "fr" ? "Prêt d'urgence garanti" : "Guaranteed Emergency Loan"}
            </p>
            <p className="text-[11px] text-slate-600">
              {userStars >= 4
                ? `⭐ ${userStars}/5 étoiles — Vérifiez votre plafond disponible`
                : `⭐ ${userStars}/5 étoiles (4 étoiles requises en cotisation publique)`}
            </p>
          </div>
        </div>
        <span className="material-symbols-outlined text-slate-400">chevron_right</span>
      </Link>

      {/* ── MODALE 1 : Recharger mon portefeuille ── */}
      {isTopUpOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-100 flex flex-col gap-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
                  <span className="material-symbols-outlined text-xl">add_card</span>
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">
                    {lang === "fr" ? "Recharger mon portefeuille" : "Top up my wallet"}
                  </h3>
                  <p className="text-[11px] text-slate-500">Orange Money ou MTN Mobile Money</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsTopUpOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-slate-100 text-slate-500 cursor-pointer"
              >
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            </div>

            {topUpError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-medium">
                {topUpError}
              </div>
            )}
            {topUpMessage && pollingState !== "POLLING" && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-medium flex items-center gap-2">
                <span className="material-symbols-outlined text-emerald-700 text-[18px]">check_circle</span>
                <span>{topUpMessage}</span>
              </div>
            )}

            {pollingState === "POLLING" ? (
              <div className="flex flex-col items-center justify-center py-6 px-2 text-center gap-4">
                <div className="relative flex items-center justify-center">
                  <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-800 animate-pulse">
                    <span className="material-symbols-outlined text-3xl">phone_iphone</span>
                  </div>
                  <div className="absolute inset-0 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
                </div>

                <div>
                  <h4 className="font-extrabold text-sm text-slate-900">
                    {lang === "fr" ? "Validation requise sur votre téléphone" : "Phone validation required"}
                  </h4>
                  <p className="text-xs text-slate-600 mt-1 max-w-xs leading-relaxed">
                    {lang === "fr"
                      ? `Veuillez composer votre code secret Mobile Money sur votre téléphone (${phone}) pour valider le débit de ${formatXAF(totalDebit)}.`
                      : `Please enter your Mobile Money PIN on your phone (${phone}) to approve ${formatXAF(totalDebit)}.`}
                  </p>
                </div>

                <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-bold">
                  <span className="material-symbols-outlined text-[16px] animate-spin">sync</span>
                  <span>
                    {lang === "fr" ? `Vérification automatique (${pollingSecondsLeft}s)` : `Checking status (${pollingSecondsLeft}s)`}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setPollingTransId(null);
                    setPollingState("IDLE");
                  }}
                  className="text-xs text-slate-500 hover:text-slate-800 underline font-medium mt-2 cursor-pointer"
                >
                  {lang === "fr" ? "Annuler l'attente" : "Cancel waiting"}
                </button>
              </div>
            ) : pollingState === "SUCCESS" ? (
              <div className="flex flex-col items-center justify-center py-6 px-2 text-center gap-3">
                <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
                  <span className="material-symbols-outlined text-3xl">check_circle</span>
                </div>
                <h4 className="font-extrabold text-base text-slate-900">
                  {lang === "fr" ? "Recharge réussie !" : "Top-up successful!"}
                </h4>
                <p className="text-xs text-slate-600">
                  {topUpMessage || (lang === "fr" ? "Votre portefeuille a été crédité avec succès." : "Your wallet has been credited.")}
                </p>
              </div>
            ) : (
              <form onSubmit={handleTopUp} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-700">Montant à recharger :</label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {[5000, 10000, 25000, 50000].map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => setTopUpAmountInput(String(amt))}
                        className={`py-1.5 px-2 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                          topUpAmount === amt
                            ? "bg-emerald-700 text-white border-emerald-700"
                            : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                        }`}
                      >
                        {amt.toLocaleString("fr-FR")} F
                      </button>
                    ))}
                  </div>
                  <div className="relative mt-1">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={topUpAmountInput}
                      onChange={(e) => {
                        const clean = e.target.value.replace(/\D/g, "").replace(/^0+/, "");
                        setTopUpAmountInput(clean);
                      }}
                      placeholder="Montant (ex: 5000)"
                      className="w-full bg-white border-2 border-emerald-600 focus:border-emerald-700 focus:ring-2 focus:ring-emerald-600/25 focus:outline-none rounded-xl px-3 py-2.5 text-sm font-bold text-slate-900"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-emerald-700">
                      FCFA
                    </span>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-700">Numéro MTN / Orange Money :</label>
                  <input
                    type="tel"
                    inputMode="tel"
                    maxLength={9}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 9))}
                    placeholder="6XXXXXXXX"
                    className="w-full bg-white border-2 border-emerald-600 focus:border-emerald-700 focus:ring-2 focus:ring-emerald-600/25 focus:outline-none rounded-xl px-3 py-2.5 text-sm font-bold text-slate-900"
                  />
                  <OperatorBadge operator={topUpOperatorInfo} lang={lang} className="mt-1" />
                  {isTopUpOperatorSuspended && (
                    <div className="mt-1.5 p-2.5 rounded-xl bg-red-50 border-2 border-red-400 text-xs text-red-800 font-semibold flex items-start gap-2">
                      <span className="material-symbols-outlined text-red-600 text-[18px] flex-shrink-0">warning</span>
                      <span>{topUpSuspendedReason}</span>
                    </div>
                  )}
                </div>

                <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-2xl flex flex-col gap-1.5 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>Montant crédité :</span>
                    <span className="font-bold text-slate-900">{formatXAF(topUpAmount)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Frais ({initialFeePercentage}%) :</span>
                    <span className="font-bold text-slate-900">{formatXAF(calculatedFee)}</span>
                  </div>
                  <div className="pt-1 border-t border-slate-200 flex justify-between font-extrabold text-sm text-emerald-950">
                    <span>Total prélevé :</span>
                    <span className="text-emerald-800">{formatXAF(totalDebit)}</span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    {isPrivateMember
                      ? "Frais de 5,1% appliqués pour les membres de cotisations privées."
                      : "Frais opérateur Orange / MTN de 3,1% (cotisation publique)."}
                  </p>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setIsTopUpOpen(false)}
                    className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-bold text-xs cursor-pointer"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || isTopUpOperatorSuspended}
                    className="flex-1 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    {isSubmitting ? <LoadingSpinner /> : <span>Payer {formatXAF(totalDebit)}</span>}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ── MODALE 2 : Retirer vers Mobile Money (Sécurisé PIN + Whitelist + Seuil 50k) ── */}
      {isWithdrawOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-100 flex flex-col gap-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
                  <span className="material-symbols-outlined text-xl">payments</span>
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">Retirer vers Mobile Money</h3>
                  <p className="text-[11px] text-emerald-700 font-semibold">0 % de frais pour le membre</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsWithdrawOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-slate-100 text-slate-500 cursor-pointer"
              >
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            </div>

            {withdrawalLockRemainingHours > 0 ? (
              <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-xs text-red-900 flex flex-col gap-2">
                <p className="font-bold flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-red-600 text-[18px]">lock_clock</span>
                  Verrouillage de sécurité 48h actif
                </p>
                <p>
                  Suite à un changement récent de numéro de téléphone, les retraits sont temporairement bloqués pendant encore{" "}
                  <strong>{withdrawalLockRemainingHours} heure(s)</strong> pour protéger vos fonds.
                </p>
              </div>
            ) : !hasPin ? (
              <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex flex-col gap-3">
                <p className="font-bold">Code PIN à 4 chiffres requis</p>
                <p>
                  Pour votre sécurité anti-piratage, vous devez définir un code PIN à 4 chiffres avant d&apos;effectuer votre premier retrait.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setIsWithdrawOpen(false);
                    setIsPinOpen(true);
                  }}
                  className="py-2.5 px-4 rounded-xl bg-amber-700 text-white font-bold text-xs cursor-pointer"
                >
                  Configurer mon code PIN maintenant
                </button>
              </div>
            ) : approvedMethods.length === 0 ? (
              <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex flex-col gap-3">
                <p className="font-bold">Aucun numéro de retrait validé</p>
                <p>
                  Enregistrez votre numéro MTN ou Orange Money avec son nom officiel dans votre profil. Une fois vérifié et validé par DIVA Asso, vous pourrez retirer librement.
                </p>
                <Link
                  href="/profile"
                  className="py-2.5 px-4 rounded-xl bg-emerald-700 text-white font-bold text-xs text-center"
                >
                  Enregistrer mon numéro de retrait
                </Link>
              </div>
            ) : (
              <form onSubmit={handleWithdraw} className="flex flex-col gap-4">
                {withdrawError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-medium">
                    {withdrawError}
                  </div>
                )}
                {withdrawSuccess && (
                  <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-medium">
                    {withdrawSuccess}
                  </div>
                )}

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-700">
                    Numéro de retrait validé (Whitelist DIVA) :
                  </label>
                  <div className="flex flex-col gap-2">
                    {approvedMethods.map((m) => {
                      const isMethodSuspended =
                        (m.provider === "ORANGE" && operatorSuspension.isOrangeSuspended) ||
                        (m.provider === "MTN" && operatorSuspension.isMtnSuspended);
                      return (
                        <label
                          key={m.id}
                          className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer ${
                            isMethodSuspended
                              ? "border-red-300 bg-red-50/60"
                              : selectedMethodId === m.id
                                ? "border-emerald-600 bg-emerald-50/70"
                                : "border-slate-200"
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <input
                              type="radio"
                              name="withdraw-method"
                              checked={selectedMethodId === m.id}
                              onChange={() => setSelectedMethodId(m.id)}
                              className="accent-emerald-700"
                            />
                            <div>
                              <p className="text-xs font-bold text-slate-900">
                                {m.provider} · {m.phone}
                              </p>
                              <p className="text-[11px] text-slate-500">{m.accountName}</p>
                            </div>
                          </div>
                          {isMethodSuspended ? (
                            <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-bold">
                              Suspendu
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                              Validé
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                  {isWithdrawOperatorSuspended && (
                    <div className="mt-1 p-2.5 rounded-xl bg-red-50 border-2 border-red-400 text-xs text-red-800 font-semibold flex items-start gap-2">
                      <span className="material-symbols-outlined text-red-600 text-[18px] flex-shrink-0">block</span>
                      <span>
                        {withdrawSuspendedReason}
                        {approvedMethods.length > 1
                          ? " Sélectionnez un autre numéro validé ci-dessus pour continuer."
                          : ""}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-700">
                    Montant à retirer (Solde : {formatXAF(balance)}) :
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={withdrawAmountInput}
                    onChange={(e) => {
                      const clean = e.target.value.replace(/\D/g, "").replace(/^0+/, "");
                      setWithdrawAmountInput(clean);
                    }}
                    placeholder="Montant à retirer"
                    className="w-full bg-white border-2 border-emerald-600 focus:border-emerald-700 focus:ring-2 focus:ring-emerald-600/25 focus:outline-none rounded-xl px-3.5 py-2.5 text-sm font-bold text-slate-900"
                  />
                  <p className="text-[11px] font-semibold text-slate-600">
                    Min : <strong className="text-slate-900">{formatXAF(withdrawalLimits.minAmount)}</strong> · Max autorisé :{" "}
                    <strong className="text-emerald-800">{formatXAF(withdrawalLimits.maxAmount)}</strong>
                  </p>
                  {balance < withdrawalLimits.minAmount && (
                    <p className="text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                      Solde disponible insuffisant pour effectuer un retrait.
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-700">Code PIN de sécurité (4 chiffres) :</label>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    value={withdrawPin}
                    onChange={(e) => setWithdrawPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    placeholder="••••"
                    className="w-full bg-white border-2 border-emerald-600 focus:border-emerald-700 focus:ring-2 focus:ring-emerald-600/25 focus:outline-none rounded-xl px-3.5 py-2.5 text-center text-lg font-mono tracking-[0.5em] font-extrabold text-slate-900"
                  />
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setIsWithdrawOpen(false)}
                    className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-bold text-xs cursor-pointer"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={withdrawing || isWithdrawOperatorSuspended || balance < withdrawalLimits.minAmount}
                    className="flex-1 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    {withdrawing ? <LoadingSpinner /> : <span>Confirmer le retrait</span>}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ── MODALE 3 : Configurer / Modifier le Code PIN 4 chiffres ── */}
      {isPinOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-slate-100 flex flex-col gap-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="font-bold text-sm text-slate-900">
                {hasPin ? "Modifier mon code PIN de retrait" : "Créer mon code PIN (4 chiffres)"}
              </h3>
              <button
                type="button"
                onClick={() => setIsPinOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-slate-100 text-slate-500 cursor-pointer"
              >
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            </div>

            {pinError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-medium">
                {pinError}
              </div>
            )}
            {pinSuccess && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-medium">
                {pinSuccess}
              </div>
            )}

            <form onSubmit={handleSavePin} className="flex flex-col gap-3">
              {hasPin && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-bold text-slate-700">Code PIN actuel</label>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    value={currentPin}
                    onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    placeholder="••••"
                    className="w-full bg-white border-2 border-emerald-600 focus:border-emerald-700 focus:ring-2 focus:ring-emerald-600/25 focus:outline-none rounded-xl px-3 py-2 text-center font-mono tracking-[0.5em] text-base font-bold"
                  />
                </div>
              )}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-slate-700">Nouveau code PIN (4 chiffres)</label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  required
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  placeholder="••••"
                  className="w-full bg-white border-2 border-emerald-600 focus:border-emerald-700 focus:ring-2 focus:ring-emerald-600/25 focus:outline-none rounded-xl px-3 py-2 text-center font-mono tracking-[0.5em] text-base font-bold"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-slate-700">Confirmer le code PIN</label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  required
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  placeholder="••••"
                  className="w-full bg-white border-2 border-emerald-600 focus:border-emerald-700 focus:ring-2 focus:ring-emerald-600/25 focus:outline-none rounded-xl px-3 py-2 text-center font-mono tracking-[0.5em] text-base font-bold"
                />
              </div>
              <button
                type="submit"
                disabled={savingPin}
                className="mt-2 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs cursor-pointer disabled:opacity-50"
              >
                {savingPin ? "Enregistrement..." : "Enregistrer mon PIN"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
