"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { translate, type Lang } from "@/lib/i18n/translations";
import { LoadingSpinner } from "@/components/loading-spinner";
import { PAYOUT_CLAIM_STATUS_KEY } from "@/lib/payout-claim-status-label";
import { detectMobileMoneyProvider } from "@/lib/mobile-money-provider";

interface FoodRequestRow {
  id: string;
  status: "DETAILS_SUBMITTED" | "RELEASED" | "CONFIRMED";
  membershipSlotId?: string;
  beneficiaryName: string;
  memberName: string;
  payoutPhone: string;
  payoutAccountName: string;
  payoutMtnPhone?: string | null;
  payoutMtnName?: string | null;
  payoutOrangePhone?: string | null;
  payoutOrangeName?: string | null;
  tontineSessionId: string;
  contributionLabel: string;
  detailsSubmittedAt: string;
}

export function FoodRequestsClient({ lang }: { lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const [rows, setRows] = useState<FoodRequestRow[] | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/payout-claims")
      .then((r) => r.json())
      .then((b) => setRows(b.claims ?? []));
  }, []);

  function handleCopy(text: string, key: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey((cur) => (cur === key ? null : cur));
    }, 2000);
  }

  return (
    <main className="px-container-padding pt-stack-gap-lg pb-32 max-w-3xl mx-auto w-full flex flex-col gap-stack-gap-lg">
      <div>
        <h2 className="font-headline-lg-mobile text-headline-lg-mobile md:font-headline-lg md:text-headline-lg text-primary flex items-center gap-2">
          <span className="material-symbols-outlined text-[28px] md:text-[32px]">restaurant</span>
          {t("foodTurnTab")}
        </h2>
        <p className="text-on-surface-variant font-body-lg mt-2">{t("foodRequestsSubtitle")}</p>
      </div>

      {rows === null ? (
        <LoadingSpinner fullPage />
      ) : rows.length === 0 ? (
        <p className="font-label-sm text-label-sm text-on-surface-variant">{t("noFoodTurnRequests")}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {rows.map((r) => {
            const mtnDigits = (r.payoutMtnPhone || (detectMobileMoneyProvider(r.payoutPhone) === "MTN" ? r.payoutPhone : "")).replace(/\D/g, "").slice(-9);
            const mtnName = r.payoutMtnName || r.payoutAccountName;

            const orangeDigits = (r.payoutOrangePhone || (detectMobileMoneyProvider(r.payoutPhone) === "ORANGE" ? r.payoutPhone : "")).replace(/\D/g, "").slice(-9);
            const orangeName = r.payoutOrangeName || r.payoutAccountName;

            return (
              <div
                key={r.id}
                className="rounded-xl p-4 flex flex-col gap-3.5 border-2 border-emerald-600/40 bg-emerald-50/20 hover:bg-emerald-50/30 transition-all shadow-xs"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-emerald-800 font-label-sm text-label-sm font-bold mb-1">
                      <span className="material-symbols-outlined text-[18px]">verified</span>
                      <span>{lang === "fr" ? "Coordonnées de virement fournies (MTN & Orange)" : "Payout details submitted (MTN & Orange)"}</span>
                    </div>
                    <p className="font-title-md text-title-md text-slate-900 truncate font-semibold">
                      {r.beneficiaryName} ({r.memberName})
                    </p>
                    <p className="font-label-sm text-label-sm text-slate-500 truncate mt-0.5">
                      {r.contributionLabel}
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center px-2.5 py-1 rounded-md font-label-sm text-label-sm flex-shrink-0 font-medium ${
                      r.status === "RELEASED"
                        ? "bg-secondary-container/40 text-on-secondary-container"
                        : "bg-amber-100 text-amber-900 border border-amber-300"
                    }`}
                  >
                    {t(PAYOUT_CLAIM_STATUS_KEY[r.status])}
                  </span>
                </div>

                {/* Box des deux numéros (MTN & ORANGE) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* COMPTE MTN */}
                  <div className="rounded-xl border border-amber-300 bg-amber-50/60 p-3 flex flex-col justify-between gap-2.5 shadow-2xs">
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <span className="inline-flex items-center gap-1 rounded bg-[#FFCC00] px-2 py-0.5 text-[11px] font-bold text-black shadow-2xs">
                          MTN Mobile Money
                        </span>
                        <button
                          onClick={(e) => handleCopy(mtnDigits, `mtn-phone-${r.id}`, e)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-white border border-amber-300 text-slate-700 hover:bg-amber-100"
                        >
                          <span className="material-symbols-outlined text-[13px]">
                            {copiedKey === `mtn-phone-${r.id}` ? "check" : "content_copy"}
                          </span>
                          {copiedKey === `mtn-phone-${r.id}` ? t("copied") : t("copy")}
                        </button>
                      </div>

                      <div className="text-sm">
                        <span className="text-slate-500 text-xs block">Numéro :</span>
                        <span className="font-bold font-numeric-data text-slate-900">{mtnDigits ? `+237 ${mtnDigits}` : "Non spécifié"}</span>
                      </div>

                      <div className="text-sm">
                        <span className="text-slate-500 text-xs block">Nom du compte :</span>
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-semibold text-slate-900 truncate">{mtnName || "Non spécifié"}</span>
                          {mtnName && (
                            <button
                              onClick={(e) => handleCopy(mtnName, `mtn-name-${r.id}`, e)}
                              className="text-slate-500 hover:text-slate-800 p-0.5"
                              title={t("copyAccountName")}
                            >
                              <span className="material-symbols-outlined text-[15px]">
                                {copiedKey === `mtn-name-${r.id}` ? "check" : "content_copy"}
                              </span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    <Link
                      href={`/admin/contributions/${r.tontineSessionId}?tab=foodTurn&fillSlot=${r.membershipSlotId ?? ""}&fillName=${encodeURIComponent(mtnName)}&fillPhone=${encodeURIComponent(mtnDigits)}`}
                      className="w-full bg-[#FFCC00] hover:bg-[#e6b800] text-black font-label-sm text-xs py-2 rounded-lg flex items-center justify-center gap-1.5 font-bold transition-colors shadow-2xs"
                    >
                      <span className="material-symbols-outlined text-[16px]">send_money</span>
                      <span>{lang === "fr" ? "Payer via MTN" : "Pay with MTN"}</span>
                    </Link>
                  </div>

                  {/* COMPTE ORANGE */}
                  <div className="rounded-xl border border-orange-300 bg-orange-50/60 p-3 flex flex-col justify-between gap-2.5 shadow-2xs">
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <span className="inline-flex items-center gap-1 rounded bg-[#FF6600] px-2 py-0.5 text-[11px] font-bold text-white shadow-2xs">
                          Orange Money
                        </span>
                        <button
                          onClick={(e) => handleCopy(orangeDigits, `orange-phone-${r.id}`, e)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-white border border-orange-300 text-slate-700 hover:bg-orange-100"
                        >
                          <span className="material-symbols-outlined text-[13px]">
                            {copiedKey === `orange-phone-${r.id}` ? "check" : "content_copy"}
                          </span>
                          {copiedKey === `orange-phone-${r.id}` ? t("copied") : t("copy")}
                        </button>
                      </div>

                      <div className="text-sm">
                        <span className="text-slate-500 text-xs block">Numéro :</span>
                        <span className="font-bold font-numeric-data text-slate-900">{orangeDigits ? `+237 ${orangeDigits}` : "Non spécifié"}</span>
                      </div>

                      <div className="text-sm">
                        <span className="text-slate-500 text-xs block">Nom du compte :</span>
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-semibold text-slate-900 truncate">{orangeName || "Non spécifié"}</span>
                          {orangeName && (
                            <button
                              onClick={(e) => handleCopy(orangeName, `orange-name-${r.id}`, e)}
                              className="text-slate-500 hover:text-slate-800 p-0.5"
                              title={t("copyAccountName")}
                            >
                              <span className="material-symbols-outlined text-[15px]">
                                {copiedKey === `orange-name-${r.id}` ? "check" : "content_copy"}
                              </span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    <Link
                      href={`/admin/contributions/${r.tontineSessionId}?tab=foodTurn&fillSlot=${r.membershipSlotId ?? ""}&fillName=${encodeURIComponent(orangeName)}&fillPhone=${encodeURIComponent(orangeDigits)}`}
                      className="w-full bg-[#FF6600] hover:bg-[#e65c00] text-white font-label-sm text-xs py-2 rounded-lg flex items-center justify-center gap-1.5 font-bold transition-colors shadow-2xs"
                    >
                      <span className="material-symbols-outlined text-[16px]">send_money</span>
                      <span>{lang === "fr" ? "Payer via Orange" : "Pay with Orange"}</span>
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
