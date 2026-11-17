"use client";

import { useState } from "react";
import Link from "next/link";
import { type Lang } from "@/lib/i18n/translations";
import { formatXAF } from "@/lib/format-currency";
import { LoadingSpinner } from "@/components/loading-spinner";

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
  disbursementMethods,
  initialWithdrawals,
}: WalletClientProps) {
  const [balance, setBalance] = useState(initialBalance);
  const [operations, setOperations] = useState<WalletOperation[]>(initialOperations);
  const [withdrawals, setWithdrawals] = useState<WithdrawalItem[]>(initialWithdrawals);
  const [hasPin, setHasPin] = useState(initialHasPin);
  const [isBalanceHidden, setIsBalanceHidden] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  // Top-up modal state
  const [isTopUpOpen, setIsTopUpOpen] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState<number>(10000);
  const [phone, setPhone] = useState<string>(
    disbursementMethods[0]?.phone || userPhone || "",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [topUpMessage, setTopUpMessage] = useState<string | null>(null);
  const [topUpError, setTopUpError] = useState<string | null>(null);

  // Withdraw modal state
  const approvedMethods = disbursementMethods.filter((m) => m.status === "APPROVED");
  const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState<number>(5000);
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

  // Fee calculations for top-up
  const feeRate = initialFeePercentage / 100;
  const calculatedFee = Math.round(topUpAmount * feeRate);
  const totalDebit = topUpAmount + calculatedFee;

  // Show 3 first operations by default
  const displayedOperations = isExpanded ? operations : operations.slice(0, 3);
  const hasMoreThanThree = operations.length > 3;

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
        return;
      }

      setTopUpMessage(data.message);
      if (typeof data.newBalance === "number") {
        setBalance(data.newBalance);
      }

      const newOp: WalletOperation = {
        id: `deposit-${Date.now()}`,
        type: "DEPOSIT",
        direction: "IN",
        title: lang === "fr" ? "Recharge portefeuille" : "Wallet Top-up",
        subtitle: `Mobile Money · ${phone}`,
        amount: topUpAmount,
        formattedAmount: `+ ${formatXAF(topUpAmount)}`,
        fee: calculatedFee,
        date: new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "short" }),
        timestamp: Date.now(),
      };
      setOperations((prev) => [newOp, ...prev]);

      setTimeout(() => {
        setIsTopUpOpen(false);
        setTopUpMessage(null);
      }, 2500);
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
    if (!withdrawAmount || withdrawAmount < 500) {
      setWithdrawError("Le montant minimum de retrait est de 500 FCFA.");
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
            date: new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "short" }),
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
      <div className="bg-[#0b3d2e] rounded-3xl p-6 sm:p-7 text-white shadow-xl relative overflow-hidden flex flex-col justify-between min-h-[185px] border border-emerald-900/40">
        <div className="absolute -right-8 -top-8 w-36 h-36 rounded-full bg-emerald-500/10 blur-xl pointer-events-none" />
        <div className="absolute -left-8 -bottom-8 w-32 h-32 rounded-full bg-emerald-400/10 blur-lg pointer-events-none" />

        <div className="flex items-center justify-between relative z-10">
          <span className="text-xs sm:text-sm font-medium text-emerald-200/90 tracking-wide">
            {lang === "fr" ? "Solde disponible" : "Available balance"}
          </span>
          <button
            type="button"
            onClick={() => setIsBalanceHidden((prev) => !prev)}
            className="p-1.5 rounded-full hover:bg-white/10 text-emerald-200 transition-colors cursor-pointer"
            title={isBalanceHidden ? "Afficher le solde" : "Masquer le solde"}
          >
            <span className="material-symbols-outlined text-[20px]">
              {isBalanceHidden ? "visibility_off" : "visibility"}
            </span>
          </button>
        </div>

        <div className="my-2 relative z-10">
          <p className="text-3xl sm:text-4xl font-extrabold tracking-tight">
            {isBalanceHidden ? "•••••• FCFA" : formatXAF(balance)}
          </p>
          <p className="text-xs text-emerald-200/80 mt-1 font-medium">
            {lang === "fr" ? "Total cotisé :" : "Total contributed:"}{" "}
            <span className="font-semibold text-white">
              {isBalanceHidden ? "•••••• FCFA" : formatXAF(initialTotalContributed)}
            </span>
          </p>
        </div>

        {/* Actions: Recharger + Retirer (0% frais) */}
        <div className="pt-3 relative z-10 flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setIsTopUpOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white text-emerald-950 font-bold text-xs hover:bg-emerald-50 active:scale-95 transition-all shadow-md cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px] text-emerald-800">add_circle</span>
            <span>{lang === "fr" ? "Recharger" : "Top up"}</span>
          </button>
          <button
            type="button"
            onClick={() => setIsWithdrawOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600/40 hover:bg-emerald-600/60 text-white border border-emerald-300/30 font-bold text-xs active:scale-95 transition-all cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">payments</span>
            <span>{lang === "fr" ? "Retirer (0 % frais)" : "Withdraw (0% fee)"}</span>
          </button>
        </div>
      </div>

      {/* ── Accès rapide Prêt d'Urgence Garanti (4 Étoiles) ── */}
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

      {/* ── Retraits en attente de validation Admin (>= 50 000 FCFA) ── */}
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
            {topUpMessage && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-medium flex items-center gap-2">
                <span className="material-symbols-outlined text-emerald-700 text-[18px]">check_circle</span>
                <span>{topUpMessage}</span>
              </div>
            )}

            <form onSubmit={handleTopUp} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-700">Montant à recharger :</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {[5000, 10000, 25000, 50000].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setTopUpAmount(amt)}
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
                    type="number"
                    min={500}
                    step={500}
                    value={topUpAmount}
                    onChange={(e) => setTopUpAmount(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-900"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                    FCFA
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-700">Numéro MTN / Orange Money :</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="6XXXXXXXX"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-900"
                />
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
                  disabled={isSubmitting}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {isSubmitting ? <LoadingSpinner /> : <span>Payer {formatXAF(totalDebit)}</span>}
                </button>
              </div>
            </form>
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
                    {approvedMethods.map((m) => (
                      <label
                        key={m.id}
                        className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer ${
                          selectedMethodId === m.id
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
                        <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                          Validé
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-700">
                    Montant à retirer (Solde : {formatXAF(balance)}) :
                  </label>
                  <input
                    type="number"
                    min={500}
                    max={balance}
                    step={500}
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-bold text-slate-900"
                  />
                  <p className="text-[11px] font-semibold text-slate-500">
                    {withdrawAmount >= 50_000
                      ? "🔒 Montant >= 50 000 FCFA : validation sécurisée par l'administrateur requise."
                      : "⚡ Montant < 50 000 FCFA : virement automatique immédiat (0 % frais)."}
                  </p>
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
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-center text-lg font-mono tracking-[0.5em] font-extrabold text-slate-900"
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
                    disabled={withdrawing}
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
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-center font-mono tracking-[0.5em] text-base font-bold"
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
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-center font-mono tracking-[0.5em] text-base font-bold"
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
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-center font-mono tracking-[0.5em] text-base font-bold"
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
