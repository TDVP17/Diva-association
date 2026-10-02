"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Image from "next/image";
import {
  isBiometricLockEnabled,
  isSessionUnlocked,
  setSessionUnlocked,
  authenticateWithBiometrics,
  detectBiometricType,
  verifyBackupPin,
  hasBackupPin,
  touchLastActive,
  getLastActiveTimestamp,
  type BiometricType,
} from "@/lib/biometrics";
import { type Lang } from "@/lib/i18n/translations";

const AUTO_LOCK_GRACE_PERIOD_MS = 45 * 1000; // 45 seconds of backgrounding before re-lock

export function BiometricLockGate({ lang }: { lang: Lang }) {
  const [isLocked, setIsLocked] = useState(false);
  const [bioType, setBioType] = useState<BiometricType>("generic");
  const [authenticating, setAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPinInput, setShowPinInput] = useState(false);
  const [pinDigits, setPinDigits] = useState<string>("");
  const [pinError, setPinError] = useState<string | null>(null);
  const hasPin = useRef(false);

  const checkLockState = useCallback(() => {
    if (!isBiometricLockEnabled()) {
      setIsLocked(false);
      return;
    }
    const unlocked = isSessionUnlocked();
    const lastActive = getLastActiveTimestamp();
    const now = Date.now();

    if (!unlocked || (lastActive > 0 && now - lastActive > AUTO_LOCK_GRACE_PERIOD_MS)) {
      setSessionUnlocked(false);
      setIsLocked(true);
      setShowPinInput(false);
      setPinDigits("");
      setError(null);
    } else {
      setIsLocked(false);
      touchLastActive();
    }
  }, []);

  const triggerBiometricAuth = useCallback(async () => {
    setAuthenticating(true);
    setError(null);
    try {
      const res = await authenticateWithBiometrics();
      if (res.success) {
        setIsLocked(false);
        setSessionUnlocked(true);
      } else {
        setError(
          lang === "fr"
            ? "Authentification biométrique échouée. Réessayez ou utilisez votre code PIN."
            : "Biometric authentication failed. Try again or use your PIN.",
        );
      }
    } catch {
      setError(
        lang === "fr"
          ? "Impossible d'utiliser la biométrie. Utilisez votre code PIN."
          : "Could not use biometrics. Use your PIN.",
      );
    } finally {
      setAuthenticating(false);
    }
  }, [lang]);

  useEffect(() => {
    setBioType(detectBiometricType());
    hasPin.current = hasBackupPin();
    checkLockState();

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        checkLockState();
      } else {
        // App went to background
        touchLastActive();
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", checkLockState);

    // Activity tracker to refresh lastActive
    const interval = setInterval(() => {
      if (isBiometricLockEnabled() && isSessionUnlocked()) {
        touchLastActive();
      }
    }, 15000);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", checkLockState);
      clearInterval(interval);
    };
  }, [checkLockState]);

  // Automatically prompt biometrics on lock appearance
  useEffect(() => {
    if (isLocked && !showPinInput) {
      const timer = setTimeout(() => {
        triggerBiometricAuth();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isLocked, showPinInput, triggerBiometricAuth]);

  async function handlePinSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (pinDigits.length < 4) return;
    setPinError(null);
    const valid = await verifyBackupPin(pinDigits);
    if (valid) {
      setIsLocked(false);
      setSessionUnlocked(true);
      setPinDigits("");
    } else {
      setPinError(lang === "fr" ? "Code PIN incorrect." : "Incorrect PIN.");
      setPinDigits("");
    }
  }

  function handleNumKey(num: string) {
    if (pinDigits.length >= 4) return;
    const next = pinDigits + num;
    setPinDigits(next);
    if (next.length === 4) {
      verifyBackupPin(next).then((valid) => {
        if (valid) {
          setIsLocked(false);
          setSessionUnlocked(true);
          setPinDigits("");
        } else {
          setPinError(lang === "fr" ? "Code PIN incorrect." : "Incorrect PIN.");
          setPinDigits("");
        }
      });
    }
  }

  function handleBackspace() {
    setPinDigits((prev) => prev.slice(0, -1));
    setPinError(null);
  }

  if (!isLocked) return null;

  const bioLabel =
    bioType === "face_id"
      ? "Face ID"
      : bioType === "touch_id"
        ? "Touch ID"
        : bioType === "fingerprint"
          ? (lang === "fr" ? "Empreinte digitale" : "Fingerprint")
          : (lang === "fr" ? "Biométrie" : "Biometrics");

  const bioIcon = bioType === "face_id" ? "face" : "fingerprint";

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[999999] flex flex-col items-center justify-center p-4 bg-gradient-to-b from-[#00281e] via-[#001b14] to-[#000f0a] text-white select-none backdrop-blur-md animate-fadeIn"
    >
      <div className="w-full max-w-sm flex flex-col items-center text-center">
        {/* App Logo */}
        <div className="relative mb-4 flex items-center justify-center">
          <div className="absolute -inset-3 rounded-full bg-emerald-500/20 blur-xl animate-pulse" />
          <div className="relative w-20 h-20 rounded-2xl bg-gradient-to-br from-emerald-800 to-[#00281e] p-2.5 shadow-2xl border border-emerald-500/40 flex items-center justify-center">
            <Image
              src="/icons/icon-512.png"
              alt="DIVA Association"
              width={64}
              height={64}
              className="object-contain drop-shadow"
              priority
            />
          </div>
        </div>

        <h2 className="text-xl font-bold tracking-tight text-white mb-1">
          {lang === "fr" ? "Application Verrouillée" : "Application Locked"}
        </h2>
        <p className="text-xs text-emerald-200/80 mb-8 max-w-[260px]">
          {lang === "fr"
            ? "DIVA Association est protégée. Authentifiez-vous pour accéder à vos cotisations."
            : "DIVA Association is protected. Authenticate to access your cotisations."}
        </p>

        {!showPinInput ? (
          <div className="flex flex-col items-center w-full">
            {/* Biometric Scan Trigger Button */}
            <button
              onClick={triggerBiometricAuth}
              disabled={authenticating}
              className="group relative flex flex-col items-center justify-center w-28 h-28 rounded-3xl bg-gradient-to-b from-emerald-600 to-emerald-800 text-white shadow-[0_0_35px_rgba(5,150,105,0.4)] border-2 border-emerald-400/50 hover:scale-105 active:scale-95 transition-all cursor-pointer disabled:opacity-70"
            >
              <span className="material-symbols-outlined text-[48px] group-hover:scale-110 transition-transform">
                {bioIcon}
              </span>
              <span className="text-[10px] font-semibold mt-1 uppercase tracking-wider text-emerald-100">
                {authenticating ? (lang === "fr" ? "Scan..." : "Scanning...") : bioLabel}
              </span>
            </button>

            <p className="text-xs text-slate-300 mt-4 mb-2">
              {lang === "fr" ? `Touchez pour déverrouiller avec ${bioLabel}` : `Tap to unlock with ${bioLabel}`}
            </p>

            {error && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-red-950/80 border border-red-500/50 text-red-200 text-xs text-center max-w-xs animate-shake">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setShowPinInput(true);
                setError(null);
              }}
              className="mt-8 text-xs text-emerald-400 hover:text-emerald-300 underline underline-offset-4 font-medium transition-colors"
            >
              {lang === "fr" ? "Utiliser le code PIN de secours" : "Use backup PIN code"}
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center w-full animate-fadeIn">
            <h3 className="text-sm font-semibold text-emerald-200 mb-4">
              {lang === "fr" ? "Entrez votre code PIN (4 chiffres)" : "Enter your 4-digit PIN"}
            </h3>

            {/* PIN Dots */}
            <div className="flex gap-4 mb-6">
              {[0, 1, 2, 3].map((idx) => {
                const filled = pinDigits.length > idx;
                return (
                  <div
                    key={idx}
                    className={`w-3.5 h-3.5 rounded-full transition-all duration-200 ${
                      filled
                        ? "bg-emerald-400 scale-125 shadow-[0_0_8px_rgba(52,211,153,0.8)]"
                        : "bg-slate-700 border border-slate-600"
                    }`}
                  />
                );
              })}
            </div>

            {pinError && (
              <p className="text-xs text-red-400 font-semibold mb-3 animate-shake">{pinError}</p>
            )}

            {/* Custom Numeric Keypad for fast input on mobile */}
            <div className="grid grid-cols-3 gap-3 w-64 max-w-full mb-4">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => handleNumKey(n)}
                  className="h-13 rounded-2xl bg-white/10 hover:bg-white/20 active:bg-white/30 text-white text-xl font-bold font-numeric-data transition-colors flex items-center justify-center shadow-xs"
                >
                  {n}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setShowPinInput(false);
                  setPinDigits("");
                }}
                className="h-13 rounded-2xl bg-transparent text-emerald-400 text-xs font-semibold hover:bg-white/5 flex items-center justify-center"
              >
                <span className="material-symbols-outlined text-[20px]">{bioIcon}</span>
              </button>
              <button
                type="button"
                onClick={() => handleNumKey("0")}
                className="h-13 rounded-2xl bg-white/10 hover:bg-white/20 active:bg-white/30 text-white text-xl font-bold font-numeric-data transition-colors flex items-center justify-center shadow-xs"
              >
                0
              </button>
              <button
                type="button"
                onClick={handleBackspace}
                className="h-13 rounded-2xl bg-transparent text-slate-300 text-xs font-semibold hover:bg-white/5 active:bg-white/10 flex items-center justify-center"
                aria-label="Backspace"
              >
                <span className="material-symbols-outlined text-[20px]">backspace</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
