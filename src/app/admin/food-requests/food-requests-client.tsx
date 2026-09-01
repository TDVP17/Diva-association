"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { translate, type Lang } from "@/lib/i18n/translations";
import { LoadingSpinner } from "@/components/loading-spinner";

interface FoodRequestRow {
  id: string;
  status: "DETAILS_SUBMITTED" | "RELEASED" | "CONFIRMED";
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

  useEffect(() => {
    fetch("/api/admin/payout-claims")
      .then((r) => r.json())
      .then((b) => setRows(b.claims ?? []));
  }, []);

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
        <div className="flex flex-col gap-3">
          {rows.map((r) => (
            <Link
              key={r.id}
              href={`/admin/contributions/${r.tontineSessionId}`}
              className="rounded-lg p-4 flex items-center justify-between gap-3 border-2 border-error/40 bg-error-container/20 hover:bg-error-container/30 transition-colors"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-error font-label-sm text-label-sm font-bold mb-1">
                  <span className="material-symbols-outlined text-[18px]">warning</span>
                  {t("foodTurnActionRequired")}
                </div>
                <p className="font-label-md text-label-md text-on-surface truncate">
                  {r.beneficiaryName} ({r.memberName})
                </p>
                <p className="font-label-sm text-label-sm text-on-surface-variant truncate">{r.contributionLabel}</p>
              </div>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-md font-label-sm text-label-sm flex-shrink-0 ${
                  r.status === "RELEASED" ? "bg-secondary-container/40 text-on-secondary-container" : "bg-secondary-fixed text-on-secondary-fixed-variant"
                }`}
              >
                {r.status}
              </span>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
