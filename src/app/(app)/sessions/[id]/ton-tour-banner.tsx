"use client";

import { translate, type Lang } from "@/lib/i18n/translations";
import { getCycleDateForRound } from "@/lib/tontine-engine";
import type { TontineType } from "@/generated/prisma/enums";

export interface MemberSlotInfo {
  id: string;
  beneficiaryName: string;
  officialPosition: number | null;
  ballDrawn: number | null;
}

export function TonTourBanner({
  mySlots,
  sessionType,
  startDate,
  isBeneficiaryTurn = false,
  lang,
}: {
  mySlots: MemberSlotInfo[];
  sessionType: TontineType;
  startDate: Date;
  isBeneficiaryTurn?: boolean;
  lang: Lang;
}) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);

  if (!mySlots || mySlots.length === 0) return null;

  // Find user's best slot
  const slotWithPosition = mySlots.find((s) => s.officialPosition !== null) ?? mySlots[0];
  const position = slotWithPosition?.officialPosition;
  const ballDrawn = slotWithPosition?.ballDrawn;

  let headline = "";
  let subtitle = "";

  if (isBeneficiaryTurn) {
    headline = lang === "fr" ? "Ton tour : C'est le moment ! 🎉" : "Your turn: Right now! 🎉";
    subtitle =
      lang === "fr"
        ? "Ordre de bouffe : Vous recevez la cagnotte de ce tour"
        : "Payout order: You receive the pot this round";
  } else if (position !== null && position !== undefined) {
    try {
      const cycleDate = getCycleDateForRound(sessionType, startDate, position);
      const monthRaw = cycleDate.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", {
        timeZone: "Africa/Douala",
        month: "long",
      });
      const monthCap = monthRaw.charAt(0).toUpperCase() + monthRaw.slice(1);
      headline = t("yourTurnTitle", { turn: monthCap });

      const posSuffix =
        position === 1
          ? t("firstPositionSuffix")
          : position === 2
          ? t("secondPositionSuffix")
          : position === 3
          ? t("thirdPositionSuffix")
          : t("nthPositionSuffix", { n: String(position) });
      subtitle = t("payoutPositionSubtitle", { pos: posSuffix });
    } catch {
      headline = t("yourTurnTitle", { turn: String(position) });
      subtitle = t("payoutPositionSubtitle", { pos: `${position}e position` });
    }
  } else if (ballDrawn !== null && ballDrawn !== undefined) {
    headline = t("yourTurnTitle", { turn: `Boule n°${ballDrawn}` });
    subtitle = t("payoutPositionSubtitle", { pos: t("drawConfirmed") });
  } else {
    headline = t("yourTurnTitle", { turn: t("upcomingDraw") });
    subtitle = t("payoutPositionSubtitle", { pos: t("waitingForDraw") });
  }

  return (
    <div className="bg-white rounded-2xl p-3.5 sm:p-4 shadow-sm border border-slate-100 flex items-center gap-3.5 my-3.5">
      <div className="w-12 h-12 rounded-full bg-amber-100/90 flex items-center justify-center flex-shrink-0 text-2xl shadow-xs">
        🎉
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-extrabold text-slate-900 text-sm sm:text-base leading-snug truncate">
          {headline}
        </p>
        <p className="text-xs text-slate-500 font-medium truncate mt-0.5">
          {subtitle}
        </p>
      </div>
    </div>
  );
}
