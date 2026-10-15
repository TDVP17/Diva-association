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
  designatedSlotId,
  lang,
}: {
  mySlots: MemberSlotInfo[];
  sessionType: TontineType;
  startDate: Date;
  tontineSessionId?: string;
  isBeneficiaryTurn?: boolean;
  designatedSlotId?: string | null;
  lang: Lang;
}) {
  const router = useRouter();
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);

  if (!mySlots || mySlots.length === 0) return null;

  // Crucial requirement: No positions or "tour de bouffer" message may ever be visible
  // until the member has selected their lucky ball(s) (ballDrawn !== null).
  const hasUndrawnSlots = mySlots.some((s) => s.ballDrawn === null);

  if (hasUndrawnSlots) {
    const headline = lang === "fr" ? "Tirage au sort du cycle" : "Cycle Lucky Draw";
    const subtitle =
      lang === "fr"
        ? "Tirez votre boule chanceuse pour découvrir votre position !"
        : "Pick your lucky ball to discover your position!";

    return (
      <div
        onClick={() => {
          if (tontineSessionId) router.push(`/sessions/${tontineSessionId}/draw`);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && tontineSessionId) {
            router.push(`/sessions/${tontineSessionId}/draw`);
          }
        }}
        className="bg-white rounded-2xl p-3.5 sm:p-4 shadow-sm border border-slate-100 flex items-center gap-3.5 my-3.5 cursor-pointer hover:bg-slate-50/80 active:scale-[0.99] transition-all select-none"
      >
        <div className="w-12 h-12 rounded-full bg-amber-100/90 flex items-center justify-center flex-shrink-0 text-2xl shadow-xs transition-transform hover:scale-110">
          🎲
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

  function getSlotDate(pos: number | null) {
    if (pos === null) return "";
    try {
      const cycleDate = getCycleDateForRound(sessionType, startDate, pos);
      return cycleDate.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", {
        timeZone: "Africa/Douala",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    } catch {
      return "";
    }
  }

  function getPosLabel(pos: number | null) {
    if (pos === null) return "";
    if (pos === 1) return lang === "fr" ? "1ère position" : "1st position";
    if (pos === 2) return lang === "fr" ? "2e position" : "2nd position";
    if (pos === 3) return lang === "fr" ? "3e position" : "3rd position";
    return `${pos}e position`;
  }

  // Multi-slot view: when the member holds 2 or more names, display all of them clearly
  if (mySlots.length > 1) {
    return (
      <div
        onClick={() => playCelebrationSound()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") playCelebrationSound();
        }}
        className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 my-3.5 select-none cursor-pointer hover:bg-slate-50/40 transition-colors"
      >
        <div className="flex items-center gap-2.5 mb-3 pb-2.5 border-b border-slate-100">
          <div className="w-9 h-9 rounded-full bg-amber-100/90 flex items-center justify-center text-lg flex-shrink-0 shadow-xs">
            🎉
          </div>
          <div>
            <h3 className="font-extrabold text-slate-900 text-sm sm:text-base leading-tight">
              {lang === "fr" ? `Vos tours de bouffe (${mySlots.length} noms enregistrés)` : `Your payout turns (${mySlots.length} registered names)`}
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {lang === "fr" ? "Chaque nom bouffera à son tour selon sa position" : "Each name will receive its pot on its assigned position"}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {mySlots.map((s) => {
            const isThisSlotTurn = isBeneficiaryTurn && s.id === designatedSlotId;
            const posStr = getPosLabel(s.officialPosition);
            const dateStr = getSlotDate(s.officialPosition);

            return (
              <div
                key={s.id}
                className={`flex items-center justify-between gap-2 p-2.5 rounded-xl border transition-all ${
                  isThisSlotTurn
                    ? "bg-emerald-50/90 border-emerald-300 shadow-xs"
                    : "bg-slate-50/70 border-slate-100"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-bold text-sm text-slate-900">{s.beneficiaryName}</span>
                    {posStr && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-700 font-semibold shadow-2xs">
                        {posStr}
                      </span>
                    )}
                    {isThisSlotTurn && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-600 text-white font-bold animate-pulse shadow-xs">
                        {lang === "fr" ? "C'est le moment ! 🎉" : "Right now! 🎉"}
                      </span>
                    )}
                  </div>
                  {dateStr && (
                    <p className="text-xs text-slate-500 mt-0.5">
                      {lang === "fr" ? `Date : ${dateStr}` : `Date: ${dateStr}`}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Single-slot view
  let headline = "";
  let subtitle = "";

  if (isBeneficiaryTurn) {
    const slotWithPosition = mySlots.find((s) => s.officialPosition !== null) ?? mySlots[0];
    const position = slotWithPosition?.officialPosition;
    const posSuffix = getPosLabel(position ?? null);
    const dateExacteStr = getSlotDate(position ?? null);

    if (dateExacteStr) {
      headline =
        lang === "fr"
          ? `Ton tour : ${dateExacteStr} (C'est le moment ! 🎉)`
          : `Your turn: ${dateExacteStr} (Right now! 🎉)`;
    } else {
      headline = lang === "fr" ? "Ton tour : C'est le moment ! 🎉" : "Your turn: Right now! 🎉";
    }

    if (posSuffix) {
      subtitle =
        lang === "fr"
          ? `Ordre de bouffe : ${posSuffix}`
          : `Payout order: ${posSuffix}`;
    } else {
      subtitle =
        lang === "fr"
          ? "Ordre de bouffe : Vous recevez la cagnotte de ce tour"
          : "Payout order: You receive the pot this round";
    }
  } else {
    const slotWithPosition = mySlots.find((s) => s.officialPosition !== null) ?? mySlots[0];
    const position = slotWithPosition?.officialPosition;
    const ballDrawn = slotWithPosition?.ballDrawn;

    if (position !== null && position !== undefined) {
      const exactDateStr = getSlotDate(position);
      if (exactDateStr) {
        headline = t("yourTurnTitle", { turn: exactDateStr });
      } else {
        headline = t("yourTurnTitle", { turn: String(position) });
      }

      const posSuffix = getPosLabel(position);
      subtitle = t("payoutPositionSubtitle", { pos: posSuffix });
    } else if (ballDrawn !== null && ballDrawn !== undefined) {
      headline = t("yourTurnTitle", { turn: `Boule n°${ballDrawn}` });
      subtitle = t("payoutPositionSubtitle", { pos: t("drawConfirmed") });
    } else {
      headline = t("yourTurnTitle", { turn: t("upcomingDraw") });
      subtitle = t("payoutPositionSubtitle", { pos: t("waitingForDraw") });
    }
  }

  function handleClick() {
    playCelebrationSound();
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
