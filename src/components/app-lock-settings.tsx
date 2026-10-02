"use client";

import { useEffect, useState } from "react";
import { type Lang } from "@/lib/i18n/translations";

export const STORAGE_APP_LOCK_KEY = "diva_app_lock_enabled";
export const SESSION_APP_UNLOCKED_KEY = "diva_app_session_unlocked";
export const STORAGE_APP_LAST_ACTIVE_KEY = "diva_app_last_active";

export function isAppLockEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(STORAGE_APP_LOCK_KEY) === "true";
}

export function setAppLockEnabled(enabled: boolean) {
  if (typeof window === "undefined") return;
  if (enabled) {
    localStorage.setItem(STORAGE_APP_LOCK_KEY, "true");
    localStorage.setItem(STORAGE_APP_LAST_ACTIVE_KEY, String(Date.now()));
    sessionStorage.setItem(SESSION_APP_UNLOCKED_KEY, "true");
  } else {
    localStorage.removeItem(STORAGE_APP_LOCK_KEY);
    localStorage.removeItem(STORAGE_APP_LAST_ACTIVE_KEY);
    sessionStorage.removeItem(SESSION_APP_UNLOCKED_KEY);
  }
}

export function AppLockSettings({ lang }: { lang: Lang }) {
  const [enabled, setEnabled] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setEnabled(isAppLockEnabled());
  }, []);

  function handleToggle() {
    const nextState = !enabled;
    setEnabled(nextState);
    setAppLockEnabled(nextState);
  }

  if (!mounted) return null;

  return (
    <div className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-colors ${
            enabled ? "bg-emerald-50 text-emerald-600" : "bg-primary/10 text-primary"
          }`}>
            <span className="material-symbols-outlined text-2xl">
              {enabled ? "lock" : "lock_open"}
            </span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-label-md text-label-md text-on-surface font-semibold truncate">
                {lang === "fr" ? "Verrouillage de l'application" : "Application Lock"}
              </p>
              {enabled && (
                <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full shrink-0">
                  {lang === "fr" ? "Actif" : "Active"}
                </span>
              )}
            </div>
            <p className="font-label-sm text-xs text-on-surface-variant mt-0.5 leading-snug">
              {enabled
                ? lang === "fr"
                  ? "Protège vos cotisations dès que vous quittez ou fermez l'écran"
                  : "Protects your cotisations as soon as you leave or lock the screen"
                : lang === "fr"
                  ? "Verrouiller l'accès à l'application quand vous quittez l'écran"
                  : "Lock application access when you leave the screen"}
            </p>
          </div>
        </div>

        {/* 1-Tap Toggle Switch - No code, no passkey */}
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={handleToggle}
          aria-label={
            lang === "fr"
              ? "Activer ou désactiver le verrouillage de l'application"
              : "Toggle application lock"
          }
          className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
            enabled ? "bg-primary" : "bg-slate-300"
          }`}
        >
          <span
            aria-hidden="true"
            className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
              enabled ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>
    </div>
  );
}
