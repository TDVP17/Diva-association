"use client";

import { useState } from "react";
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
  lang,
}: {
  tontineSessionId: string;
  totalSlots: number;
  lang: Lang;
}) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const router = useRouter();
  const [drawing, setDrawing] = useState(false);
  const [results, setResults] = useState<DrawnSlot[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Purely decorative — the actual outcome is assigned server-side at
  // random from the pool of unclaimed numbers, regardless of which ball
  // (or the CTA) the member taps. Math.random is impure, so it's only ever
  // called inside this useState lazy initializer, React's documented
  // exception for one-time random values computed at mount.
  const [decorativeNumbers] = useState<number[]>(() =>
    Array.from({ length: Math.min(5, Math.max(totalSlots, 1)) }, () =>
      Math.max(1, Math.ceil(Math.random() * totalSlots)),
    ),
  );

  async function handleDraw() {
    if (drawing) return;
    setDrawing(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${tontineSessionId}/draw`, { method: "POST" });
      const body = await parseJsonOrThrow<{ drawn: DrawnSlot[] }>(res, t("drawFailed"));
      setTimeout(() => {
        setResults(body.drawn);
        setDrawing(false);
      }, 600);
    } catch (err) {
      setError(friendlyErrorMessage(err, t("drawFailed")));
      setDrawing(false);
    }
  }

  return (
    <>
      <div className="relative w-full max-w-[320px] h-[320px] mx-auto mb-stack-gap-lg">
        <div className="absolute inset-0 rounded-full bg-gradient-to-b from-surface-container-low to-surface-container-high border border-surface-variant flex items-center justify-center overflow-hidden shadow-[0_20px_40px_rgba(0,53,40,0.15),inset_0_-20px_40px_rgba(0,0,0,0.05)]">
          <div className="absolute inset-4 rounded-full bg-surface shadow-inner opacity-50" />
          <div className="relative w-full h-full">
            {decorativeNumbers.map((n, i) => (
              <button
                key={i}
                type="button"
                onClick={handleDraw}
                disabled={drawing}
                className={`absolute rounded-full bg-white flex items-center justify-center font-numeric-data text-numeric-data text-primary focus:outline-none transition-transform hover:scale-110 hover:-translate-y-1 shadow-[inset_-5px_-5px_15px_rgba(0,0,0,0.2),inset_5px_5px_15px_rgba(255,255,255,0.8),0_10px_20px_rgba(0,53,40,0.2)] ${FLOAT_CLASSES[i]}`}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-transparent via-white/10 to-white/40 pointer-events-none" />
        </div>
      </div>

      {error && <p className="font-label-sm text-label-sm text-error text-center mb-4">{error}</p>}

      <button
        onClick={handleDraw}
        disabled={drawing}
        className="w-full max-w-sm py-4 px-6 rounded-xl bg-primary text-on-primary font-label-md text-label-md uppercase tracking-wider shadow-[0px_8px_30px_rgba(0,53,40,0.2)] hover:shadow-[0px_10px_35px_rgba(0,53,40,0.3)] active:scale-95 transition-all duration-200 disabled:opacity-60"
      >
        {drawing ? t("drawingInProgress") : t("pickYourBalls")}
      </button>

      {results !== null && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-on-background/40 backdrop-blur-sm px-container-padding">
          <div className="bg-surface w-full max-w-sm rounded-[24px] shadow-[0px_20px_40px_rgba(0,0,0,0.2)] p-stack-gap-lg flex flex-col items-center text-center">
            <div className="flex flex-wrap justify-center gap-4 mb-stack-gap-lg mt-4">
              {results.map((r) => (
                <div key={r.slotId} className="flex flex-col items-center">
                  <div className="w-20 h-20 rounded-full bg-white flex items-center justify-center font-numeric-data text-[36px] text-primary shadow-[inset_-5px_-5px_15px_rgba(0,0,0,0.2),inset_5px_5px_15px_rgba(255,255,255,0.8),0_10px_20px_rgba(0,53,40,0.2)]">
                    {r.ballDrawn}
                  </div>
                  <p className="font-label-sm text-label-sm text-on-surface-variant mt-1">{r.beneficiaryName}</p>
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
            <button
              onClick={() => router.push(`/sessions/${tontineSessionId}`)}
              className="w-full py-3 rounded-lg border-2 border-primary text-primary font-label-md text-label-md hover:bg-primary/5 active:scale-95 transition-all"
            >
              {t("gotIt")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
