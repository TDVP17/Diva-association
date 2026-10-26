"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { translate, type Lang } from "@/lib/i18n/translations";
import { parseJsonOrThrow, friendlyErrorMessage } from "@/lib/api-error";
import { detectMobileMoneyProvider } from "@/lib/mobile-money-provider";

type PayoutStatus = "DETAILS_SUBMITTED" | "RELEASED" | "CONFIRMED" | null;

export function PayoutTurnPanel({
  membershipSlotId,
  beneficiaryName,
  payoutId,
  status,
  lang,
}: {
  membershipSlotId: string;
  beneficiaryName?: string;
  payoutId: string | null;
  status: PayoutStatus;
  lang: Lang;
}) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [accountName, setAccountName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleanPhone = phone.replace(/\D/g, "").slice(0, 9);
  const detectedProvider = detectMobileMoneyProvider(cleanPhone);

  async function submitDetails(e: React.FormEvent) {
    e.preventDefault();
    if (!cleanPhone || cleanPhone.length < 9) {
      setError(lang === "fr" ? "Veuillez entrer un numéro valide à 9 chiffres." : "Please enter a valid 9-digit number.");
      return;
    }
    if (!accountName.trim()) {
      setError(lang === "fr" ? "Veuillez entrer le nom du titulaire du compte." : "Please enter the account holder name.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/payments/payout-claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membershipSlotId, phone: cleanPhone, accountName: accountName.trim() }),
      });
      await parseJsonOrThrow(res, t("couldNotSubmitPayoutDetails"));
      router.refresh();
    } catch (err) {
      setError(friendlyErrorMessage(err, t("couldNotSubmitPayoutDetails")));
      setSubmitting(false);
    }
  }

  if (status === "DETAILS_SUBMITTED") {
    // As requested: the notification after submitting details to admin only belongs in the notification center
    return null;
  }

  return (
    <section className="mb-stack-gap-lg overflow-hidden rounded-2xl border-2 border-emerald-500/40 bg-gradient-to-br from-emerald-50 via-teal-50/40 to-white p-5 shadow-md">
      {status === null && (
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
              <span className="material-symbols-outlined text-[24px]">emoji_events</span>
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-title-md text-title-md font-bold text-emerald-950 flex items-center gap-2">
                {beneficiaryName
                  ? lang === "fr"
                    ? `C'est le tour de bouffer pour ${beneficiaryName} ! 🏆`
                    : `It's time to receive the payout for ${beneficiaryName}! 🏆`
                  : t("payoutTurnBannerTitle")}
              </h3>
              <p className="font-body-sm text-body-sm text-emerald-900/90 mt-1 leading-relaxed">
                {beneficiaryName
                  ? lang === "fr"
                    ? `Renseignez vos coordonnées Mobile Money ou Orange Money pour recevoir le virement de la cagnotte pour ${beneficiaryName}. L'administrateur effectuera directement votre versement.`
                    : `Provide your Mobile Money or Orange Money details to receive the pot transfer for ${beneficiaryName}. The admin will process your payout directly.`
                  : t("payoutTurnBannerDesc")}
              </p>
              <div className="mt-2.5 rounded-lg bg-emerald-100/70 border border-emerald-200/80 p-2.5 text-xs text-emerald-900 flex items-start gap-2">
                <span className="material-symbols-outlined text-[18px] text-emerald-700 flex-shrink-0 mt-0.5">check_circle</span>
                <span>
                  {lang === "fr"
                    ? "✨ Tous les membres de la tontine (y compris vous-même) ont cotisé pour ce cycle ! Vos coordonnées permettront à l'administrateur d'effectuer votre virement."
                    : "✨ All members of the tontine (including yourself) have contributed for this cycle! Your details will allow the administrator to process your transfer."}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-emerald-200 bg-white/90 p-4 shadow-xs">
            <form onSubmit={submitDetails} className="flex flex-col gap-4">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="font-label-sm text-label-sm font-semibold text-slate-800">
                    {t("payoutPhoneLabel")} <span className="text-error">*</span>
                  </label>
                  {detectedProvider === "MTN" && (
                    <span className="inline-flex items-center gap-1 rounded bg-[#FFCC00] px-2 py-0.5 text-[11px] font-bold text-black shadow-xs">
                      MTN Mobile Money
                    </span>
                  )}
                  {detectedProvider === "ORANGE" && (
                    <span className="inline-flex items-center gap-1 rounded bg-[#FF6600] px-2 py-0.5 text-[11px] font-bold text-white shadow-xs">
                      Orange Money
                    </span>
                  )}
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-semibold text-sm">
                    +237
                  </span>
                  <input
                    type="tel"
                    inputMode="tel"
                    maxLength={9}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 9))}
                    placeholder="6XXXXXXXX"
                    required
                    className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-14 pr-3 font-numeric-data text-base text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
                  />
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  {lang === "fr"
                    ? "Numéro de compte Mobile Money ou Orange Money (au choix) sur lequel sera crédité le virement."
                    : "Mobile Money or Orange Money account number to receive your funds."}
                </p>
              </div>

              <div>
                <label className="font-label-sm text-label-sm font-semibold text-slate-800 block mb-1.5">
                  {t("payoutAccountNameLabel")} <span className="text-error">*</span>
                </label>
                <input
                  type="text"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  placeholder={lang === "fr" ? "Ex: Jean Paul Dupont (Nom sur le compte)" : "e.g. John Doe (Name on account)"}
                  required
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-body-md text-base text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  {lang === "fr"
                    ? "Indiquez le nom officiel complet associé à ce compte pour la vérification du virement."
                    : "Enter the exact official name registered on this account for transfer verification."}
                </p>
              </div>

              {error && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-xs text-red-700 font-medium flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px]">error</span>
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || cleanPhone.length < 9 || !accountName.trim()}
                className="w-full py-3 rounded-lg bg-emerald-700 text-white font-label-md text-label-md font-semibold hover:bg-emerald-800 transition-colors shadow-sm disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <span>{lang === "fr" ? "Enregistrement..." : "Submitting..."}</span>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[20px]">send</span>
                    <span>{t("submitPayoutDetails")}</span>
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      )}

      {(status === "RELEASED" || status === "CONFIRMED") && (
        <div className="flex flex-col gap-3 bg-white/95 rounded-xl border border-emerald-400 p-4 shadow-sm">
          <div className="flex items-center gap-2.5 text-emerald-800 font-bold">
            <span className="material-symbols-outlined text-[24px] text-emerald-600">celebration</span>
            <p className="font-label-md text-label-md">
              {beneficiaryName
                ? lang === "fr"
                  ? `Virement envoyé pour ${beneficiaryName} ! 🎉`
                  : `Payout sent for ${beneficiaryName}! 🎉`
                : t("payoutSentToYou")}
            </p>
          </div>
          <p className="text-xs text-slate-600">
            {lang === "fr"
              ? "Le virement a été envoyé avec succès vers votre compte Mobile Money / Orange Money. Vous pouvez télécharger votre reçu officiel ci-dessous."
              : "The transfer has been successfully sent to your Mobile Money / Orange Money account. You can download your official statement below."}
          </p>
          {payoutId && (
            <div className="pt-1">
              <a
                href={`/api/payouts/${payoutId}/receipt`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 py-2 px-3 rounded-lg bg-emerald-700 text-white font-label-md text-label-md hover:bg-emerald-800 shadow-xs transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">picture_as_pdf</span>
                <span>{lang === "fr" ? "Télécharger le reçu de gain (PDF)" : "Download Payout Receipt (PDF)"}</span>
              </a>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
