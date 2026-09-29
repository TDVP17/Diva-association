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
            const cleanDigits = (r.payoutPhone || "").replace(/\D/g, "").replace(/^237/, "");
            const provider = detectMobileMoneyProvider(cleanDigits);
            const isNameCopied = copiedKey === `name-${r.id}`;
            const isPhoneCopied = copiedKey === `phone-${r.id}`;

            return (
              <div
                key={r.id}
                className="rounded-xl p-4 flex flex-col gap-3 border-2 border-error/40 bg-error-container/15 hover:bg-error-container/20 transition-all shadow-xs"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-error font-label-sm text-label-sm font-bold mb-1">
                      <span className="material-symbols-outlined text-[18px]">warning</span>
                      {t("foodTurnActionRequired")}
                    </div>
                    <p className="font-title-md text-title-md text-on-surface truncate font-semibold">
                      {r.beneficiaryName} ({r.memberName})
                    </p>
                    <p className="font-label-sm text-label-sm text-on-surface-variant truncate mt-0.5">
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

                {/* Box coordonnees Fapshi avec boutons copier */}
                <div className="rounded-lg border border-slate-200 bg-white p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shadow-xs">
                  <div className="flex flex-col gap-1.5 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap text-sm">
                      <span className="text-slate-500 font-medium">{t("payoutAccountNameLabel")}:</span>
                      <span className="font-bold text-slate-900 truncate">{r.payoutAccountName}</span>
                      <button
                        onClick={(e) => handleCopy(r.payoutAccountName, `name-${r.id}`, e)}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold transition-colors ${
                          isNameCopied
                            ? "bg-emerald-600 text-white"
                            : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                        }`}
                        title={t("copyAccountName")}
                      >
                        <span className="material-symbols-outlined text-[14px]">
                          {isNameCopied ? "check" : "content_copy"}
                        </span>
                        {isNameCopied ? t("copied") : t("copyAccountName")}
                      </button>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap text-sm">
                      <span className="text-slate-500 font-medium">{t("payoutPhoneLabel")}:</span>
                      <span className="font-bold font-numeric-data text-slate-900">{r.payoutPhone}</span>
                      {provider === "MTN" && (
                        <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[11px] font-bold bg-[#FFCC00] text-black">
                          MTN MoMo
                        </span>
                      )}
                      {provider === "ORANGE" && (
                        <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[11px] font-bold bg-[#FF6600] text-white">
                          Orange Money
                        </span>
                      )}
                      <button
                        onClick={(e) => handleCopy(cleanDigits, `phone-${r.id}`, e)}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold transition-colors ${
                          isPhoneCopied
                            ? "bg-emerald-600 text-white"
                            : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                        }`}
                        title={t("copyAccountNumber")}
                      >
                        <span className="material-symbols-outlined text-[14px]">
                          {isPhoneCopied ? "check" : "content_copy"}
                        </span>
                        {isPhoneCopied ? t("copied") : t("copyAccountNumber")}
                      </button>
                    </div>
                  </div>

                  <Link
                    href={`/admin/contributions/${r.tontineSessionId}?tab=foodTurn&fillSlot=${r.membershipSlotId ?? ""}&fillName=${encodeURIComponent(r.payoutAccountName)}&fillPhone=${encodeURIComponent(cleanDigits)}`}
                    className="self-stretch sm:self-center bg-primary text-on-primary font-label-sm text-label-sm px-3.5 py-2 rounded-lg hover:opacity-90 flex items-center justify-center gap-1.5 transition-opacity whitespace-nowrap shadow-xs"
                  >
                    <span className="material-symbols-outlined text-[16px]">send_money</span>
                    <span>{t("openAndFillPayout")}</span>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
