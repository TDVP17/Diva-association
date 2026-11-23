"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Lang } from "@/lib/i18n/translations";
import { parseJsonOrThrow, friendlyErrorMessage } from "@/lib/api-error";

type PayoutStatus = "DETAILS_SUBMITTED" | "RELEASED" | "CONFIRMED" | null;

export function PayoutTurnPanel({
  membershipSlotId,
  beneficiaryName,
  status,
  lang,
}: {
  membershipSlotId: string;
  beneficiaryName?: string;
  payoutId: string | null;
  status: PayoutStatus;
  lang: Lang;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAlreadyCredited = status === "CONFIRMED" || status === "RELEASED";

  async function handleClaimWallet() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/payments/payout-claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membershipSlotId }),
      });
      await parseJsonOrThrow(
        res,
        lang === "fr"
          ? "Impossible de créditer votre portefeuille actuellement."
          : "Could not credit your wallet.",
      );
      router.refresh();
    } catch (err) {
      setError(
        friendlyErrorMessage(
          err,
          lang === "fr"
            ? "Impossible de créditer votre portefeuille actuellement."
            : "Could not credit your wallet.",
        ),
      );
      setSubmitting(false);
    }
  }

  // 1. Cas : La cagnotte a déjà été créditée sur le Portefeuille DIVA Asso
  if (isAlreadyCredited) {
    return (
      <section className="mb-stack-gap-lg overflow-hidden rounded-2xl border-2 border-emerald-500/50 bg-gradient-to-br from-emerald-50 via-teal-50/40 to-white p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-emerald-700 text-white shadow-xs">
              <span className="material-symbols-outlined text-[28px]">account_balance_wallet</span>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                  <span className="material-symbols-outlined text-[13px]">check_circle</span>
                  <span>{lang === "fr" ? "Bouffe créditée sur Portefeuille" : "Pot credited to Wallet"}</span>
                </span>
              </div>
              <h3 className="font-title-md text-title-md font-bold text-emerald-950 mt-1">
                {beneficiaryName
                  ? lang === "fr"
                    ? `Félicitations ${beneficiaryName} ! 🏆`
                    : `Congratulations ${beneficiaryName}! 🏆`
                  : lang === "fr"
                    ? "C'est votre tour de bouffer la cagnotte ! 🏆"
                    : "It's your turn to receive the pot! 🏆"}
              </h3>
              <p className="font-body-sm text-xs sm:text-sm text-emerald-900/90 mt-1 leading-relaxed">
                {lang === "fr"
                  ? "Votre cagnotte a été rechargée directement sur votre Portefeuille DIVA Asso (+25% des frais inclus). Vous pouvez effectuer votre retrait à tout moment, ou laisser vos fonds pour cotiser automatiquement."
                  : "Your pot has been credited to your DIVA Asso Wallet (+25% fees included). You can withdraw your funds anytime or leave them to contribute automatically."}
              </p>
            </div>
          </div>

          <Link
            href="/wallet"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 active:scale-95 text-white font-bold text-xs sm:text-sm shadow-sm transition-all"
          >
            <span className="material-symbols-outlined text-[18px]">payments</span>
            <span>{lang === "fr" ? "Voir mon portefeuille & Retirer" : "View my wallet & Withdraw"}</span>
          </Link>
        </div>
      </section>
    );
  }

  // 2. Cas : C'est le tour de bouffer (tous les membres ont cotisé, prêt pour crédit portefeuille)
  return (
    <section className="mb-stack-gap-lg overflow-hidden rounded-2xl border-2 border-emerald-500/50 bg-gradient-to-br from-emerald-50 via-teal-50/40 to-white p-5 shadow-sm">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5 min-w-0">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-amber-500 text-white shadow-xs">
            <span className="material-symbols-outlined text-[28px]">emoji_events</span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                <span className="material-symbols-outlined text-[13px]">stars</span>
                <span>{lang === "fr" ? "Tour de bouffer disponible" : "Payout turn ready"}</span>
              </span>
            </div>
            <h3 className="font-title-md text-title-md font-bold text-emerald-950 mt-1">
              {beneficiaryName
                ? lang === "fr"
                  ? `C'est le tour de bouffer pour ${beneficiaryName} ! 🏆`
                  : `It's time to receive the payout for ${beneficiaryName}! 🏆`
                : lang === "fr"
                  ? "C'est votre tour de bouffer la cagnotte !"
                  : "It's your turn to receive the payout!"}
            </h3>
            <p className="font-body-sm text-xs sm:text-sm text-emerald-900/90 mt-1 leading-relaxed">
              {lang === "fr"
                ? "Tous les membres ont cotisé ! Votre cagnotte (+25% des frais reversés) est prête à être versée sur votre Portefeuille DIVA Asso."
                : "All members have contributed! Your pot (+25% fees bonus) is ready to be credited to your DIVA Asso Wallet."}
            </p>
            {error && (
              <p className="text-xs font-semibold text-error mt-2">
                ⚠️ {error}
              </p>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={handleClaimWallet}
          disabled={submitting}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 active:scale-95 text-white font-bold text-xs sm:text-sm shadow-sm transition-all disabled:opacity-50 cursor-pointer"
        >
          <span className="material-symbols-outlined text-[18px]">account_balance_wallet</span>
          <span>
            {submitting
              ? lang === "fr"
                ? "Rechargement en cours..."
                : "Crediting wallet..."
              : lang === "fr"
                ? "Encaisser sur mon Portefeuille"
                : "Credit to my Wallet"}
          </span>
        </button>
      </div>
    </section>
  );
}
