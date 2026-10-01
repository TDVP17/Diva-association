"use client";

import { useState } from "react";

interface DescriptionPillProps {
  description: string;
  label: string;
  className?: string;
}

export function DescriptionPill({ description, label, className = "" }: DescriptionPillProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className={`my-1 max-w-md relative z-20 ${className}`}>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsOpen((prev) => !prev);
        }}
        className="cursor-pointer inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200/80 font-medium text-[11px] hover:bg-emerald-100 transition-colors shadow-2xs"
        aria-expanded={isOpen}
      >
        <span className="text-[12px]">✨</span>
        <span>{label}</span>
      </button>
      {isOpen && (
        <div
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          className="font-body-sm text-xs text-on-surface-variant mt-1.5 bg-surface-container-low/95 p-2.5 rounded-lg border border-surface-variant/80 leading-relaxed shadow-sm whitespace-pre-line"
        >
          {description}
        </div>
      )}
    </div>
  );
}
