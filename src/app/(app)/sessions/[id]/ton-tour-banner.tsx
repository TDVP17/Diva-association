"use client";

import { translate, type Lang } from "@/lib/i18n/translations";
import { getCycleDateForRound } from "@/lib/tontine-engine";
import { playCelebrationSound } from "@/lib/sound-effects";
import type { TontineType } from "@/generated/prisma/enums";

import { useRouter } from "next/navigation";

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
  tontineSessionId,
  isBeneficiaryTurn = false,
  lang,
}: {
  mySlots: MemberSlotInfo[];
  sessionType: TontineType;
  startDate: Date;
  tontineSessionId?: string;
  isBeneficiaryTurn?: boolean;
  lang: Lang;
}) {
  const router = useRouter();
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);

  if (!mySlots || mySlots.length === 0) return null;

  // Crucial requirement: No positions or "tour de bouffer" message may ever be visible
  // until the member has selected their lucky ball(s) (ballDrawn !== null).
  const hasUndrawnSlots = mySlots.some((s) => s.ballDrawn === null);

  let headline = "";
  let subtitle = "";
  let icon = "🎉";
  let isDrawAction = false;

  if (hasUndrawnSlots) {
    headline = lang === "fr" ? "Tirage au sort du cycle" : "Cycle Lucky Draw";
    subtitle =
      lang === "fr"
        ? "Tirez votre boule chanceuse pour découvrir votre position !"
        : "Pick your lucky ball to discover your position!";
    icon = "🎲";
    isDrawAction = true;
  } else if (isBeneficiaryTurn) {
    headline = lang === "fr" ? "Ton tour : C'est le moment ! 🎉" : "Your turn: Right now! 🎉";
    const slotWithPosition = mySlots.find((s) => s.officialPosition !== null) ?? mySlots[0];
    const position = slotWithPosition?.officialPosition;
    const posSuffix =
      position === 1
        ? (lang === "fr" ? "1ère position" : "1st position")
        : position === 2
        ? (lang === "fr" ? "2e position" : "2nd position")
        : position === 3
        ? (lang === "fr" ? "3e position" : "3rd position")
        : position !== null && position !== undefined
        ? `${position}e position`
        : "";

    let dateExacteStr = "";
    if (position !== null && position !== undefined) {
      try {
        const cycleDate = getCycleDateForRound(sessionType, startDate, position);
        dateExacteStr = cycleDate.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", {
          timeZone: "Africa/Douala",
          day: "numeric",
          month: "short",
          year: "numeric",
        });
      } catch {}
    }

    if (posSuffix && dateExacteStr) {
      subtitle =
        lang === "fr"
          ? `Ordre de bouffe : ${posSuffix} (${dateExacteStr})`
          : `Payout order: ${posSuffix} (${dateExacteStr})`;
    } else {
      subtitle =
        lang === "fr"
          ? "Ordre de bouffe : Vous recevez la cagnotte de ce tour"
          : "Payout order: You receive the pot this round";
    }
  } else {
    // Member has drawn their balls: reveal the assigned position
    const slotWithPosition = mySlots.find((s) => s.officialPosition !== null) ?? mySlots[0];
    const position = slotWithPosition?.officialPosition;
    const ballDrawn = slotWithPosition?.ballDrawn;

    if (position !== null && position !== undefined) {
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
  }

  function handleClick() {
    if (isDrawAction && tontineSessionId) {
      router.push(`/sessions/${tontineSessionId}/draw`);
    } else {
      playCelebrationSound();
    }
  }

  return (
    <div
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") handleClick();
      }}
      className="bg-white rounded-2xl p-3.5 sm:p-4 shadow-sm border border-slate-100 flex items-center gap-3.5 my-3.5 cursor-pointer hover:bg-slate-50/80 active:scale-[0.99] transition-all select-none"
    >
      <div className="w-12 h-12 rounded-full bg-amber-100/90 flex items-center justify-center flex-shrink-0 text-2xl shadow-xs transition-transform hover:scale-110">
        {icon}
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
