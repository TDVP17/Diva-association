"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { translate, type Lang } from "@/lib/i18n/translations";
import { parseJsonOrThrow, friendlyErrorMessage } from "@/lib/api-error";

const FLOAT_CLASSES = [
  "top-[20%] left-[25%] w-14 h-14 animate-[float_4s_ease-in-out_infinite]",
  "top-[40%] right-[15%] w-16 h-16 animate-[float_5s_ease-in-out_infinite_1s]",
  "bottom-[25%] left-[20%] w-16 h-16 animate-[float_4.5s_ease-in-out_infinite_0.5s]",
  "bottom-[15%] right-[30%] w-14 h-14 animate-[float_5.5s_ease-in-out_infinite_1.5s]",
  "top-[35%] left-[45%] w-14 h-14 animate-[float_4.2s_ease-in-out_infinite_2s]",
];

interface DrawnSlot {
  slotId: string;
  beneficiaryName: string;
  ballDrawn: number;
}

export function DrawBowl({
  tontineSessionId,
  totalSlots,
  undrawnSlots,
  totalUserSlots,
  lang,
}: {
  tontineSessionId: string;
  totalSlots: number;
  undrawnSlots: Array<{ id: string; beneficiaryName: string }>;
  totalUserSlots: number;
  lang: Lang;
}) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const router = useRouter();
  const [currentSlots, setCurrentSlots] = useState(undrawnSlots);
  const [drawing, setDrawing] = useState(false);
  const [results, setResults] = useState<DrawnSlot[] | null>(null);
  const [remainingUndrawnCount, setRemainingUndrawnCount] = useState<number>(0);
  const [selectedBallIndex, setSelectedBallIndex] = useState<number | null>(null);
  const [nextSlotName, setNextSlotName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);

  const activeSlot = currentSlots[0];
  const currentStep = totalUserSlots - currentSlots.length + 1;

  // The draw assigns each slot's position from the session's shared
  // unclaimed-number pool server-side — it has to stay perfectly
  // consistent across every member, so unlike a contribution there's no
  // safe way to queue this offline. Disabled with a clear reason instead
  // of letting the fetch fail generically.
  useEffect(() => {
    const handle = setTimeout(() => {
      setIsOnline(navigator.onLine);
    }, 0);
    function handleOnline() {
      setIsOnline(true);
    }
    function handleOffline() {
      setIsOnline(false);
    }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      clearTimeout(handle);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // In a real lottery / tontine draw, the numbers on the balls must be
  // completely hidden until the member actually draws their ball.
  const ballCount = Math.min(FLOAT_CLASSES.length, Math.max(totalSlots, 1));
  const floatingBalls = FLOAT_CLASSES.slice(0, ballCount);

  async function handleDraw() {
    if (drawing || !activeSlot || selectedBallIndex === null) return;
    if (!isOnline) {
      setError(t("drawRequiresConnection"));
      return;
    }
    setDrawing(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${tontineSessionId}/draw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotId: activeSlot.id }),
      });
      const body = await parseJsonOrThrow<{
        drawn: DrawnSlot[];
        remainingUndrawnCount: number;
        nextSlotName: string | null;
      }>(res, t("drawFailed"));

      setTimeout(() => {
        setResults(body.drawn);
        setRemainingUndrawnCount(body.remainingUndrawnCount);
        setNextSlotName(body.nextSlotName);
        setDrawing(false);
      }, 600);
    } catch (err) {
      setError(friendlyErrorMessage(err, t("drawFailed")));
      setDrawing(false);
    }
  }

  function handleContinueNextSlot() {
    setCurrentSlots((prev) => prev.slice(1));
    setSelectedBallIndex(null);
    setResults(null);
  }

  return (
    <>
      {totalUserSlots > 1 && activeSlot && (
        <div className="mb-4 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 font-label-md text-sm shadow-sm">
          <span className="material-symbols-outlined text-[18px]">person</span>
          <span>
            {t("drawForSlot", {
              name: activeSlot.beneficiaryName,
              current: String(currentStep),
              total: String(totalUserSlots),
            })}
          </span>
        </div>
      )}

      <div className="relative w-full max-w-[320px] h-[320px] mx-auto mb-stack-gap-lg">
        <div className="absolute inset-0 rounded-full bg-gradient-to-b from-surface-container-low to-surface-container-high border border-surface-variant flex items-center justify-center overflow-hidden shadow-[0_20px_40px_rgba(0,53,40,0.15),inset_0_-20px_40px_rgba(0,0,0,0.05)]">
          <div className="absolute inset-4 rounded-full bg-surface shadow-inner opacity-50" />
          <div className="relative w-full h-full">
            {floatingBalls.map((floatClass, i) => {
              const isSelected = selectedBallIndex === i;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    if (!drawing) setSelectedBallIndex(i);
                  }}
                  disabled={drawing || !isOnline || !activeSlot}
                  aria-label={t("pickYourBalls")}
                  className={`absolute rounded-full flex items-center justify-center font-bold text-2xl select-none focus:outline-none transition-all duration-300 cursor-pointer ${
                    isSelected
                      ? "ring-4 ring-amber-400 bg-amber-100 text-amber-700 scale-125 -translate-y-2 z-20 shadow-[0_0_25px_rgba(251,191,36,0.9),inset_-5px_-5px_15px_rgba(0,0,0,0.15)]"
                      : selectedBallIndex !== null
                      ? "bg-white/80 text-emerald-800/20 opacity-60 scale-95 shadow-[inset_-5px_-5px_15px_rgba(0,0,0,0.1),0_5px_10px_rgba(0,53,40,0.1)]"
                      : `bg-white text-emerald-800/40 hover:scale-110 hover:-translate-y-1 shadow-[inset_-5px_-5px_15px_rgba(0,0,0,0.2),inset_5px_5px_15px_rgba(255,255,255,0.8),0_10px_20px_rgba(0,53,40,0.2)] ${floatClass}`
                  }`}
                >
                  {isSelected ? "✨" : "?"}
                </button>
              );
            })}
          </div>
          <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-transparent via-white/10 to-white/40 pointer-events-none" />
        </div>
      </div>

      {/* Instruction text */}
      <p className="text-center font-medium text-xs sm:text-sm text-emerald-900 mb-3">
        {selectedBallIndex === null
          ? (lang === "fr" ? "Touchez une boule dans l'urne pour la choisir" : "Tap a ball in the bowl to select it")
          : (lang === "fr" ? "Boule sélectionnée ! Cliquez ci-dessous pour valider" : "Ball selected! Click below to validate")}
      </p>

      {error && <p className="font-label-sm text-label-sm text-error text-center mb-4">{error}</p>}

      <button
        onClick={handleDraw}
        disabled={drawing || !isOnline || !activeSlot || selectedBallIndex === null}
        className={`w-full max-w-sm py-4 px-6 rounded-xl font-label-md text-label-md uppercase tracking-wider transition-all duration-200 cursor-pointer ${
          selectedBallIndex === null
            ? "bg-slate-200 text-slate-400 cursor-not-allowed opacity-60 shadow-none"
            : "bg-primary text-on-primary shadow-[0px_8px_30px_rgba(0,53,40,0.25)] hover:shadow-[0px_10px_35px_rgba(0,53,40,0.35)] active:scale-95"
        }`}
      >
        {drawing
          ? t("drawingInProgress")
          : selectedBallIndex === null
          ? t("selectBallFirst")
          : activeSlot
          ? t("confirmBallSelection", { name: activeSlot.beneficiaryName })
          : t("pickYourBalls")}
      </button>
      {!isOnline && (
        <p className="font-label-sm text-label-sm text-on-surface-variant text-center mt-2">
          {t("drawRequiresConnection")}
        </p>
      )}

      {results !== null && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-on-background/40 backdrop-blur-sm px-container-padding">
          <div className="bg-surface w-full max-w-sm rounded-[24px] shadow-[0px_20px_40px_rgba(0,0,0,0.2)] p-stack-gap-lg flex flex-col items-center text-center">
            <div className="flex flex-wrap justify-center gap-4 mb-stack-gap-lg mt-4">
              {results.map((r) => (
                <div key={r.slotId} className="flex flex-col items-center">
                  <div className="w-20 h-20 rounded-full bg-white flex items-center justify-center font-numeric-data text-[36px] text-primary shadow-[inset_-5px_-5px_15px_rgba(0,0,0,0.2),inset_5px_5px_15px_rgba(255,255,255,0.8),0_10px_20px_rgba(0,53,40,0.2)]">
                    {r.ballDrawn}
                  </div>
                  <p className="font-label-sm text-label-sm text-on-surface-variant mt-1 font-semibold">{r.beneficiaryName}</p>
                </div>
              ))}
            </div>
            <h3 className="font-title-md text-title-md text-on-surface mb-2">
              {results.length > 1
                ? t("youDrewBalls", { count: String(results.length) })
                : t("youDrewBall", { number: String(results[0]?.ballDrawn) })}
            </h3>
            <div className="flex items-center gap-2 bg-secondary-fixed-dim/20 text-on-secondary-container px-4 py-2 rounded-lg mb-stack-gap-lg">
              <span className="material-symbols-outlined text-[18px]">pending_actions</span>
              <p className="font-label-sm text-label-sm">{t("pendingAdminValidation")}</p>
            </div>

            {remainingUndrawnCount > 0 ? (
              <div className="w-full flex flex-col gap-2">
                <p className="font-label-sm text-on-surface-variant mb-1">
                  {t("drawRemainingNotice", { count: String(remainingUndrawnCount) })}
                </p>
                <button
                  type="button"
                  onClick={handleContinueNextSlot}
                  className="w-full py-3.5 px-4 rounded-xl bg-primary text-on-primary font-label-md text-label-md uppercase tracking-wide hover:shadow-md active:scale-95 transition-all"
                >
                  {t("drawNextSlot", { name: nextSlotName || "suivant" })}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => router.push(`/sessions/${tontineSessionId}`)}
                className="w-full py-3 rounded-lg border-2 border-primary text-primary font-label-md text-label-md hover:bg-primary/5 active:scale-95 transition-all"
              >
                {t("gotIt")}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
