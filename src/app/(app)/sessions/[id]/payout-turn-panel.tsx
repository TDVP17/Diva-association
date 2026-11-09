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

  // Dual required account info: MTN and Orange
  const [mtnPhone, setMtnPhone] = useState("");
  const [mtnAccountName, setMtnAccountName] = useState("");
  const [orangePhone, setOrangePhone] = useState("");
  const [orangeAccountName, setOrangeAccountName] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleanMtn = mtnPhone.replace(/\D/g, "").slice(0, 9);
  const cleanOrange = orangePhone.replace(/\D/g, "").slice(0, 9);

  const mtnProvider = detectMobileMoneyProvider(cleanMtn);
  const orangeProvider = detectMobileMoneyProvider(cleanOrange);

  const isMtnValid = cleanMtn.length === 9 && mtnProvider === "MTN" && mtnAccountName.trim().length > 0;
  const isOrangeValid = cleanOrange.length === 9 && orangeProvider === "ORANGE" && orangeAccountName.trim().length > 0;
  const canSubmit = isMtnValid && isOrangeValid && !submitting;

  async function submitDetails(e: React.FormEvent) {
    e.preventDefault();

    if (!cleanMtn || cleanMtn.length < 9) {
      setError(
        lang === "fr"
          ? "Veuillez entrer un numéro MTN à 9 chiffres."
          : "Please enter a 9-digit MTN number.",
      );
      return;
    }
    if (mtnProvider !== "MTN") {
      setError(
        lang === "fr"
          ? "Le premier numéro doit obligatoirement être un numéro MTN (ex: 67x, 680-684, 650-654)."
          : "The first number must be an MTN Mobile Money number.",
      );
      return;
    }
    if (!mtnAccountName.trim()) {
      setError(
        lang === "fr"
          ? "Veuillez entrer le nom enregistré sur le compte MTN."
          : "Please enter the account name for the MTN number.",
      );
      return;
    }

    if (!cleanOrange || cleanOrange.length < 9) {
      setError(
        lang === "fr"
          ? "Veuillez entrer un numéro Orange à 9 chiffres."
          : "Please enter a 9-digit Orange number.",
      );
      return;
    }
    if (orangeProvider !== "ORANGE") {
      setError(
        lang === "fr"
          ? "Le second numéro doit obligatoirement être un numéro Orange (ex: 69x, 685-689, 655-659)."
          : "The second number must be an Orange Money number.",
      );
      return;
    }
    if (!orangeAccountName.trim()) {
      setError(
        lang === "fr"
          ? "Veuillez entrer le nom enregistré sur le compte Orange."
          : "Please enter the account name for the Orange number.",
      );
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/payments/payout-claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          membershipSlotId,
          mtnPhone: cleanMtn,
          mtnAccountName: mtnAccountName.trim(),
          orangePhone: cleanOrange,
          orangeAccountName: orangeAccountName.trim(),
          phone: cleanMtn,
          accountName: mtnAccountName.trim(),
        }),
      });
      await parseJsonOrThrow(res, t("couldNotSubmitPayoutDetails"));
      router.refresh();
    } catch (err) {
      setError(friendlyErrorMessage(err, t("couldNotSubmitPayoutDetails")));
      setSubmitting(false);
    }
  }

  if (status === "DETAILS_SUBMITTED") {
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
                {lang === "fr"
                  ? `Pour recevoir votre virement pour ${beneficiaryName ?? "votre tour"}, vous devez obligatoirement fournir deux numéros (un MTN et un Orange) avec le nom de chaque compte. DIVA Asso effectuera votre virement.`
                  : `To receive your payout for ${beneficiaryName ?? "your turn"}, you must provide both an MTN and an Orange number with the name on each account. DIVA Asso will process your payout.`}
              </p>
              <div className="mt-2.5 rounded-lg bg-emerald-100/70 border border-emerald-200/80 p-2.5 text-xs text-emerald-900 flex items-start gap-2">
                <span className="material-symbols-outlined text-[18px] text-emerald-700 flex-shrink-0 mt-0.5">check_circle</span>
                <span>
                  {lang === "fr"
                    ? "✨ Tous les membres ont cotisé ! Veuillez renseigner vos deux comptes ci-dessous avant d'envoyer à DIVA Asso."
                    : "✨ All members have contributed! Please enter your two accounts below before submitting to DIVA Asso."}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-emerald-200 bg-white/95 p-4 shadow-xs">
            <form onSubmit={submitDetails} className="flex flex-col gap-5">
              {/* COMPTE 1: MTN MOBILE MONEY */}
              <div className="rounded-xl border-2 border-[#FFCC00]/50 bg-amber-50/30 p-3.5 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-[#FFCC00] text-black font-black text-xs">
                      1
                    </span>
                    <span className="font-label-md text-sm font-bold text-slate-900">
                      {lang === "fr" ? "Compte MTN Mobile Money" : "MTN Mobile Money Account"}
                    </span>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded bg-[#FFCC00] px-2 py-0.5 text-[11px] font-bold text-black shadow-2xs">
                    MTN MoMo <span className="text-[10px] opacity-80">(Requis)</span>
                  </span>
                </div>

                <div>
                  <label className="font-label-sm text-xs font-semibold text-slate-700 mb-1 flex items-center justify-between">
                    <span>
                      {lang === "fr" ? "Numéro MTN Mobile Money" : "MTN Phone Number"} <span className="text-red-600">*</span>
                    </span>
                    {cleanMtn.length >= 2 && (
                      <span className={`text-[11px] font-semibold ${mtnProvider === "MTN" ? "text-emerald-700" : "text-amber-700"}`}>
                        {mtnProvider === "MTN" ? "✓ Opérateur MTN validé" : "⚠️ Doit être un numéro MTN (67x, 680-684, 650-654)"}
                      </span>
                    )}
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-semibold text-sm">
                      +237
                    </span>
                    <input
                      type="tel"
                      inputMode="tel"
                      maxLength={9}
                      value={mtnPhone}
                      onChange={(e) => setMtnPhone(e.target.value.replace(/\D/g, "").slice(0, 9))}
                      placeholder="67XXXXXXX"
                      required
                      className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-14 pr-3 font-numeric-data text-base text-slate-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                    />
                  </div>
                </div>

                <div>
                  <label className="font-label-sm text-xs font-semibold text-slate-700 mb-1 block">
                    {lang === "fr" ? "Nom exact sur le compte MTN" : "Official name on MTN account"} <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    value={mtnAccountName}
                    onChange={(e) => setMtnAccountName(e.target.value)}
                    placeholder={lang === "fr" ? "Ex: Jean Dupont (Nom complet enregistré chez MTN)" : "e.g. John Doe (MTN registered name)"}
                    required
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-body-md text-base text-slate-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                  />
                </div>
              </div>

              {/* COMPTE 2: ORANGE MONEY */}
              <div className="rounded-xl border-2 border-[#FF6600]/40 bg-orange-50/30 p-3.5 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-[#FF6600] text-white font-black text-xs">
                      2
                    </span>
                    <span className="font-label-md text-sm font-bold text-slate-900">
                      {lang === "fr" ? "Compte Orange Money" : "Orange Money Account"}
                    </span>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded bg-[#FF6600] px-2 py-0.5 text-[11px] font-bold text-white shadow-2xs">
                    Orange Money <span className="text-[10px] opacity-90">(Requis)</span>
                  </span>
                </div>

                <div>
                  <label className="font-label-sm text-xs font-semibold text-slate-700 mb-1 flex items-center justify-between">
                    <span>
                      {lang === "fr" ? "Numéro Orange Money" : "Orange Phone Number"} <span className="text-red-600">*</span>
                    </span>
                    {cleanOrange.length >= 2 && (
                      <span className={`text-[11px] font-semibold ${orangeProvider === "ORANGE" ? "text-emerald-700" : "text-amber-700"}`}>
                        {orangeProvider === "ORANGE" ? "✓ Opérateur Orange validé" : "⚠️ Doit être un numéro Orange (69x, 685-689, 655-659)"}
                      </span>
                    )}
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-semibold text-sm">
                      +237
                    </span>
                    <input
                      type="tel"
                      inputMode="tel"
                      maxLength={9}
                      value={orangePhone}
                      onChange={(e) => setOrangePhone(e.target.value.replace(/\D/g, "").slice(0, 9))}
                      placeholder="69XXXXXXX"
                      required
                      className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-14 pr-3 font-numeric-data text-base text-slate-900 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                    />
                  </div>
                </div>

                <div>
                  <label className="font-label-sm text-xs font-semibold text-slate-700 mb-1 block">
                    {lang === "fr" ? "Nom exact sur le compte Orange" : "Official name on Orange account"} <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    value={orangeAccountName}
                    onChange={(e) => setOrangeAccountName(e.target.value)}
                    placeholder={lang === "fr" ? "Ex: Jean Dupont (Nom complet enregistré chez Orange)" : "e.g. John Doe (Orange registered name)"}
                    required
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-body-md text-base text-slate-900 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                  />
                </div>
              </div>

              {/* RAPPEL EXIGIBLE */}
              <div className="rounded-lg bg-slate-100 border border-slate-200 p-2.5 text-xs text-slate-600 flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px] text-slate-500 flex-shrink-0">info</span>
                <span>
                  {lang === "fr"
                    ? "DIVA Asso exige obligatoirement les deux numéros (un MTN et un Orange) avec leurs noms respectifs pour sécuriser et accélérer le versement."
                    : "DIVA Asso strictly requires both numbers (one MTN and one Orange) with their respective account names to secure and process your transfer."}
                </span>
              </div>

              {error && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-xs text-red-700 font-medium flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] flex-shrink-0">error</span>
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={!canSubmit}
                className="w-full py-3 rounded-lg bg-emerald-700 text-white font-label-md text-label-md font-semibold hover:bg-emerald-800 transition-colors shadow-sm disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <span>{lang === "fr" ? "Transmission à DIVA Asso..." : "Sending to DIVA Asso..."}</span>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[20px]">send</span>
                    <span>{lang === "fr" ? "Envoyer à DIVA Asso" : "Send to DIVA Asso"}</span>
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
