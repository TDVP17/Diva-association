"use client";

import { useEffect, useState, useCallback } from "react";
import Image from "next/image";
import { type Lang } from "@/lib/i18n/translations";
import {
  isAppLockEnabled,
  STORAGE_APP_LAST_ACTIVE_KEY,
  SESSION_APP_UNLOCKED_KEY,
} from "./app-lock-settings";

const LOCK_GRACE_PERIOD_MS = 45 * 1000; // 45 seconds of backgrounding before re-lock

export function AppLockGate({ lang }: { lang: Lang }) {
  const [isLocked, setIsLocked] = useState(false);
  const [mounted, setMounted] = useState(false);

  const checkLockState = useCallback(() => {
    if (!isAppLockEnabled()) {
      setIsLocked(false);
      return;
    }

    if (typeof window === "undefined") return;

    const unlocked = sessionStorage.getItem(SESSION_APP_UNLOCKED_KEY) === "true";
    const lastActiveStr = localStorage.getItem(STORAGE_APP_LAST_ACTIVE_KEY);
    const lastActive = lastActiveStr ? Number(lastActiveStr) : 0;
    const now = Date.now();

    if (!unlocked || (lastActive > 0 && now - lastActive > LOCK_GRACE_PERIOD_MS)) {
      sessionStorage.removeItem(SESSION_APP_UNLOCKED_KEY);
      setIsLocked(true);
    } else {
      setIsLocked(false);
      localStorage.setItem(STORAGE_APP_LAST_ACTIVE_KEY, String(Date.now()));
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    checkLockState();

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        checkLockState();
      } else {
        if (isAppLockEnabled()) {
          localStorage.setItem(STORAGE_APP_LAST_ACTIVE_KEY, String(Date.now()));
        }
      }
    }

    function onFocus() {
      checkLockState();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);

    // Refresh last active timestamp periodically while active
    const interval = setInterval(() => {
      if (isAppLockEnabled()) {
        const unlocked = sessionStorage.getItem(SESSION_APP_UNLOCKED_KEY) === "true";
        if (unlocked) {
          localStorage.setItem(STORAGE_APP_LAST_ACTIVE_KEY, String(Date.now()));
        }
      }
    }, 15000);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
      clearInterval(interval);
    };
  }, [checkLockState]);

  function handleUnlock() {
    if (typeof window !== "undefined") {
      sessionStorage.setItem(SESSION_APP_UNLOCKED_KEY, "true");
      localStorage.setItem(STORAGE_APP_LAST_ACTIVE_KEY, String(Date.now()));
    }
    setIsLocked(false);
  }

  if (!mounted || !isLocked) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-sm bg-white rounded-3xl p-6 sm:p-8 shadow-2xl border border-slate-100 flex flex-col items-center text-center">
        {/* App Logo */}
        <div className="relative mb-4">
          <div className="w-20 h-20 rounded-2xl bg-white shadow-md border border-slate-100 flex items-center justify-center p-2">
            <Image
              src="/icons/icon-192.png"
              alt="Diva Association"
              width={64}
              height={64}
              className="w-16 h-16 object-contain rounded-xl"
              priority
            />
          </div>
          <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-primary text-white flex items-center justify-center shadow-sm">
            <span className="material-symbols-outlined text-[16px]">lock</span>
          </div>
        </div>

        {/* Lock Info */}
        <h2 className="font-bold text-xl text-slate-900 mb-1">
          {lang === "fr" ? "Application verrouillée" : "Application Locked"}
        </h2>
        <p className="text-xs text-slate-500 mb-6 max-w-xs leading-relaxed">
          {lang === "fr"
            ? "Votre session Diva Association est protégée. Touchez le bouton ci-dessous pour reprendre."
            : "Your Diva Association session is protected. Tap below to resume."}
        </p>

        {/* 1-Tap Unlock Action (No PIN code, no passkey) */}
        <button
          type="button"
          onClick={handleUnlock}
          className="w-full py-3.5 px-4 rounded-xl bg-primary text-on-primary font-semibold text-sm hover:opacity-95 active:scale-95 transition-all flex items-center justify-center gap-2 shadow-lg cursor-pointer"
        >
          <span className="material-symbols-outlined text-[20px]">lock_open</span>
          <span>{lang === "fr" ? "Déverrouiller l'application" : "Unlock Application"}</span>
        </button>
      </div>
    </div>
  );
}
