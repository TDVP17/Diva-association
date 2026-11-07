"use client";

import type { OperatorInfo } from "@/lib/mobile-money-provider";
import type { Lang } from "@/lib/i18n/translations";

export function OperatorBadge({
  operator,
  lang = "fr",
  className = "",
}: {
  operator: OperatorInfo;
  lang?: Lang;
  className?: string;
}) {
  if (operator.status === "idle") return null;

  if (operator.status === "unknown") {
    return (
      <div
        role="alert"
        className={`flex items-center gap-2 p-2 rounded-lg border border-red-200 bg-red-50 text-red-700 text-xs font-medium animate-in fade-in duration-150 ${className}`}
      >
        <span className="material-symbols-outlined text-[16px] text-red-600 flex-shrink-0">
          error
        </span>
        <span>
          {operator.helpMessage ||
            (lang === "fr"
              ? "Opérateur inconnu — Vérifiez votre numéro (Orange ou MTN uniquement)."
              : "Unknown operator — Please check your number (Orange or MTN only).")}
        </span>
      </div>
    );
  }

  const isOrange = operator.provider === "ORANGE";

  return (
    <div
      className={`flex items-center justify-between p-2 rounded-lg border text-xs animate-in fade-in duration-150 ${
        isOrange
          ? "border-orange-300 bg-orange-50/80 text-orange-950"
          : "border-amber-300 bg-yellow-50/80 text-amber-950"
      } ${className}`}
    >
      <div className="flex items-center gap-2">
        {/* Logo / Badge visuel */}
        <div
          className={`w-6 h-6 rounded-md flex items-center justify-center font-black text-[10px] tracking-wider text-white shadow-2xs flex-shrink-0 ${
            isOrange ? "bg-[#FF7900]" : "bg-[#FFCC00] text-black font-extrabold"
          }`}
        >
          {isOrange ? "OM" : "MTN"}
        </div>
        <span className="font-bold text-xs leading-tight">
          {isOrange ? "Orange Money" : "MTN Mobile Money"}
        </span>
      </div>

      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
          isOrange ? "bg-orange-200/80 text-orange-900" : "bg-yellow-200/80 text-yellow-900"
        }`}
      >
        <span className="material-symbols-outlined text-[12px]">verified</span>
        <span>{isOrange ? "Orange" : "MTN"}</span>
      </span>
    </div>
  );
}

