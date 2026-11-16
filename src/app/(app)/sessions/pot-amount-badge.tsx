"use client";

import { useState } from "react";
import { formatXAF } from "@/lib/format-currency";

interface PotAmountBadgeProps {
  potAmount: number;
  label: string;
}

export function PotAmountBadge({ potAmount, label }: PotAmountBadgeProps) {
  const [isRevealed, setIsRevealed] = useState(false);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsRevealed((prev) => !prev);
      }}
      title={isRevealed ? "Masquer le montant" : "Cliquer pour afficher le montant"}
      className="mt-1.5 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 text-[10px] sm:text-[11px] font-semibold hover:bg-emerald-100 transition-colors cursor-pointer select-none active:scale-95"
    >
      <span className="flex items-center text-emerald-600">
        {isRevealed ? (
          <span className="material-symbols-outlined text-[14px]">emoji_events</span>
        ) : (
          <span className="relative inline-flex items-center justify-center">
            <span className="material-symbols-outlined text-[14px]">emoji_events</span>
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="w-full h-0.5 bg-red-600 rotate-45 transform origin-center rounded-full shadow-sm" />
            </span>
          </span>
        )}
      </span>
      <span>
        {label} :{" "}
        <span className="font-numeric-data font-bold">
          {isRevealed ? formatXAF(potAmount) : "•••••• FCFA"}
        </span>
      </span>
      <span className="material-symbols-outlined text-[13px] text-emerald-700/70 ml-0.5">
        {isRevealed ? "visibility_off" : "visibility"}
      </span>
    </button>
  );
}

