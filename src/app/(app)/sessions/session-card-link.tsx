"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface SessionCardLinkProps {
  href: string;
  className?: string;
  children: React.ReactNode;
}

export function SessionCardLink({ href, className = "", children }: SessionCardLinkProps) {
  const router = useRouter();
  const [isNavigating, setIsNavigating] = useState(false);

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={() => {
        if (isNavigating) return;
        setIsNavigating(true);
        router.push(href);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (isNavigating) return;
          setIsNavigating(true);
          router.push(href);
        }
      }}
      className={`relative cursor-pointer transition-all ${isNavigating ? "opacity-80 scale-[0.99] pointer-events-none" : ""} ${className}`}
    >
      {isNavigating && (
        <div className="absolute inset-0 z-20 bg-white/70 backdrop-blur-[1px] rounded-2xl flex items-center justify-center gap-2">
          <span className="w-5 h-5 border-2 border-emerald-900/30 border-t-emerald-800 rounded-full animate-spin flex-shrink-0" />
          <span className="text-xs font-semibold text-emerald-900 tracking-wide">
            Chargement...
          </span>
        </div>
      )}
      {children}
    </div>
  );
}
