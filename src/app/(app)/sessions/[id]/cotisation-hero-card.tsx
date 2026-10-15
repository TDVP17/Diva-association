"use client";

import { translate, type Lang } from "@/lib/i18n/translations";
import { formatXAF } from "@/lib/format-currency";

export function CotisationHeroCard({
  title,
  amount,
  fee = 0,
  frequencyType,
  status,
  paidCount,
  totalSlots,
  totalPotAmount,
  startDate,
  endDate,
  isDrawCompleted = false,
  lang,
}: {
  title: string;
  amount: number;
  fee?: number;
  frequencyType: string;
  status: string;
  paidCount: number;
  totalSlots: number;
  totalPotAmount: number;
  startDate?: Date | null;
  endDate?: Date | null;
  isDrawCompleted?: boolean;
  lang: Lang;
}) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);

  // Suffix matching frequency (e.g. /mois, /semaine, /2 semaines, /trimestre)
  let frequencySuffix = t("perMonthSuffix");
  if (frequencyType.startsWith("HEBDO") || frequencyType.startsWith("EVERY")) {
    frequencySuffix = t("perWeekSuffix");
  } else if (frequencyType.startsWith("BIWEEKLY")) {
    frequencySuffix = t("perTwoWeeksSuffix");
  } else if (frequencyType.startsWith("QUARTERLY")) {
    frequencySuffix = t("perQuarterSuffix");
  }

  const effectiveTotal = totalSlots > 0 ? totalSlots : 1;
  const progressPct = Math.round((paidCount / effectiveTotal) * 100);

  // Status label
  const isStatusActive = status === "ACTIVE" || (status === "DRAWING" && isDrawCompleted);
  const statusLabel = isStatusActive
    ? lang === "fr"
      ? "En cours"
      : "Active"
    : status === "DRAWING"
    ? lang === "fr"
      ? "Tirage"
      : "Drawing"
    : status === "DRAFT"
    ? lang === "fr"
      ? "En attente"
      : "Draft"
    : status;

  const startDateLabel = startDate
    ? startDate.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", {
        timeZone: "Africa/Douala",
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  const endDateLabel =
    isDrawCompleted && endDate
      ? endDate.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", {
          timeZone: "Africa/Douala",
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : null;

  return (
    <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#064e3b] via-[#064e3b] to-[#032e23] p-5 sm:p-6 text-white shadow-xl shadow-emerald-950/20 border border-emerald-500/20">
      {/* Background glow decoration */}
      <div className="absolute -right-12 -top-12 w-44 h-44 rounded-full bg-emerald-400/10 blur-2xl pointer-events-none" />

      {/* Top Header Row */}
      <div className="flex items-center justify-between gap-3 relative z-10">
        <h1 className="text-base sm:text-lg font-bold text-white tracking-wide truncate flex-1 drop-shadow-xs">
          {title}
        </h1>
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-900/80 border border-emerald-400/30 text-emerald-300 font-semibold text-xs shadow-xs flex-shrink-0">
          <span className={`w-2 h-2 rounded-full ${isStatusActive ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
          <span>{statusLabel}</span>
        </div>
      </div>

      {/* Prominent Amount & Admin Fee */}
      <div className="mt-3.5 mb-2 flex items-baseline flex-wrap gap-x-2.5 gap-y-1 relative z-10">
        <div className="flex items-baseline flex-wrap gap-x-1.5 gap-y-0.5">
          <span className="text-3xl sm:text-4xl font-black text-white tracking-tight drop-shadow-xs">
            {formatXAF(amount)}
          </span>
          {fee > 0 && (
            <span
              title={lang === "fr" ? `+ ${new Intl.NumberFormat("fr-FR").format(fee)} FCFA de frais` : `+ ${new Intl.NumberFormat("fr-FR").format(fee)} FCFA fee`}
              className="text-sm sm:text-base font-bold text-emerald-300 drop-shadow-xs"
            >
              +{new Intl.NumberFormat("fr-FR").format(fee)}
            </span>
          )}
          <span className="text-sm sm:text-base font-medium text-emerald-200/90 ml-1">
            {frequencySuffix}
          </span>
        </div>
      </div>

      {/* Dates: Début (toujours visible) & Fin (visible UNIQUEMENT quand le tirage a été fait) */}
      {startDateLabel && (
        <div className="relative z-10 mb-3 flex items-center gap-2 text-xs text-emerald-200/90 flex-wrap">
          <div className="flex items-center gap-1 bg-emerald-950/60 px-2.5 py-1 rounded-lg border border-emerald-500/20">
            <span className="material-symbols-outlined text-[14px] text-emerald-300">event</span>
            <span>
              {t("startsOnPrefix")}{" "}
              <strong className="text-white font-bold">{startDateLabel}</strong>
            </span>
          </div>

          {endDateLabel && (
            <div className="flex items-center gap-1 bg-emerald-950/60 px-2.5 py-1 rounded-lg border border-emerald-500/20 animate-in fade-in duration-300">
              <span className="material-symbols-outlined text-[14px] text-amber-300">event_available</span>
              <span>
                {t("endsOnPrefix")}{" "}
                <strong className="text-white font-bold">{endDateLabel}</strong>
              </span>
            </div>
          )}
        </div>
      )}

      {/* Modern Progress Bar */}
      <div className="relative z-10 w-full">
        <div className="w-full h-2.5 bg-[#022c22] rounded-full overflow-hidden p-0.5 shadow-inner">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-400 via-lime-400 to-emerald-400 transition-all duration-700 ease-out"
            style={{ width: `${Math.min(100, Math.max(3, progressPct))}%` }}
          />
        </div>
      </div>

      {/* Bottom Stats */}
      <div className="mt-2.5 flex items-center justify-between text-xs relative z-10">
        <span className="font-semibold text-emerald-100/90">
          {t("slotsContributedCount", {
            paid: String(paidCount),
            total: String(totalSlots),
          })}
        </span>
        <span className="font-extrabold text-emerald-100">
          {t("potLabel")} : {formatXAF(totalPotAmount)}
        </span>
      </div>
    </section>
  );
}
