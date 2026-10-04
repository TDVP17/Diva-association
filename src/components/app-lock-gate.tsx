"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Image from "next/image";
import { type Lang } from "@/lib/i18n/translations";
import {
  isBiometricLockEnabled,
  isSessionUnlocked,
  setSessionUnlocked,
  authenticateWithBiometrics,
  detectBiometricType,
  getLastActiveTimestamp,
  touchLastActive,
  type BiometricType,
} from "@/lib/biometrics";

const LOCK_GRACE_PERIOD_MS = 45 * 1000; // 45 seconds of backgrounding before re-lock

export function AppLockGate({ lang }: { lang: Lang }) {
  const [isLocked, setIsLocked] = useState(false);
  const [bioType, setBioType] = useState<BiometricType>("fingerprint");
  const [authenticating, setAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const autoTriggeredRef = useRef(false);

  const checkLockState = useCallback(() => {
    if (!isBiometricLockEnabled()) {
      setIsLocked(false);
      return;
    }

    if (typeof window === "undefined") return;

    const unlocked = isSessionUnlocked();
    const lastActive = getLastActiveTimestamp();
    const now = Date.now();

    if (!unlocked || (lastActive > 0 && now - lastActive > LOCK_GRACE_PERIOD_MS)) {
      setSessionUnlocked(false);
      setIsLocked(true);
      setError(null);
      autoTriggeredRef.current = false;
    } else {
      setIsLocked(false);
      touchLastActive();
    }
  }, []);

  const triggerBiometricUnlock = useCallback(async () => {
    if (authenticating) return;
    setAuthenticating(true);
    setError(null);

    try {
      const res = await authenticateWithBiometrics();
      if (res.success) {
        setIsLocked(false);
        setSessionUnlocked(true);
        touchLastActive();
      } else {
        setError(
          res.error ||
            (lang === "fr"
              ? "Scan biométrique annulé ou non reconnu. Touchez pour réessayer."
              : "Scan cancelled or not recognized. Tap to retry.")
        );
      }
    } catch {
      setError(
        lang === "fr"
          ? "Impossible d'accéder au capteur biométrique. Touchez pour réessayer."
          : "Could not access biometric sensor. Tap to retry."
      );
    } finally {
      setAuthenticating(false);
    }
  }, [authenticating, lang]);

  useEffect(() => {
    setMounted(true);
    setBioType(detectBiometricType());
    checkLockState();

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        checkLockState();
      } else {
        if (isBiometricLockEnabled()) {
          touchLastActive();
        }
      }
    }

    function onFocus() {
      checkLockState();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);

    const interval = setInterval(() => {
      if (isBiometricLockEnabled() && isSessionUnlocked()) {
        touchLastActive();
      }
    }, 15000);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
      clearInterval(interval);
    };
  }, [checkLockState]);

  // Automatically prompt Face ID / Fingerprint on lock appearance
  useEffect(() => {
    if (isLocked && !autoTriggeredRef.current) {
      autoTriggeredRef.current = true;
      const timer = setTimeout(() => {
        triggerBiometricUnlock();
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [isLocked, triggerBiometricUnlock]);

  if (!mounted || !isLocked) return null;

  const bioLabel =
    bioType === "face_id"
      ? "Face ID"
      : bioType === "touch_id"
      ? "Touch ID"
      : lang === "fr"
      ? "Empreinte digitale"
      : "Fingerprint";

  const bioIcon = bioType === "face_id" ? "face" : "fingerprint";

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
              alt="DIVA Asso"
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

        {/* Brand under logo */}
        <p className="font-bold text-base text-primary tracking-tight mb-1">DIVA Asso.</p>

        {/* Lock Info */}
        <h2 className="font-semibold text-lg text-slate-800 mb-1">
          {lang === "fr" ? "Application verrouillée" : "Application Locked"}
        </h2>
        <p className="text-xs text-slate-500 mb-6 max-w-xs leading-relaxed">
          {lang === "fr"
            ? `Veuillez scanner votre ${bioLabel} pour reprendre votre session.`
            : `Please scan your ${bioLabel} to resume your session.`}
        </p>

        {/* Biometric trigger button (Face ID / Fingerprint) */}
        <button
          type="button"
          onClick={triggerBiometricUnlock}
          disabled={authenticating}
          className="w-full py-3.5 px-4 rounded-xl bg-primary text-on-primary font-semibold text-sm hover:opacity-95 active:scale-95 transition-all flex items-center justify-center gap-2.5 shadow-lg cursor-pointer disabled:opacity-60"
        >
          <span className="material-symbols-outlined text-[24px]">
            {authenticating ? "hourglass_top" : bioIcon}
          </span>
          <span>
            {authenticating
              ? lang === "fr"
                ? "Scan en cours..."
                : "Scanning..."
              : lang === "fr"
              ? `Déverrouiller avec ${bioLabel}`
              : `Unlock with ${bioLabel}`}
          </span>
        </button>

        {error && (
          <p className="mt-3 text-xs text-error font-medium leading-snug">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
