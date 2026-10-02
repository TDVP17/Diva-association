"use client";

import { useEffect, useState } from "react";
import { type Lang } from "@/lib/i18n/translations";
import {
  isBiometricLockEnabled,
  registerBiometrics,
  disableBiometricLock,
  detectBiometricType,
  type BiometricType,
} from "@/lib/biometrics";

export function AppLockSettings({
  userName = "Membre",
  lang,
}: {
  userName?: string;
  lang: Lang;
}) {
  const [enabled, setEnabled] = useState(false);
  const [bioType, setBioType] = useState<BiometricType>("fingerprint");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setEnabled(isBiometricLockEnabled());
    setBioType(detectBiometricType());
  }, []);

  const bioLabel =
    bioType === "face_id"
      ? "Face ID"
      : bioType === "touch_id"
      ? "Touch ID"
      : lang === "fr"
      ? "Empreinte digitale"
      : "Fingerprint";

  const bioIcon = bioType === "face_id" ? "face" : "fingerprint";

  async function handleToggle() {
    if (loading) return;
    setError(null);

    if (enabled) {
      // 1-tap disable: no code, no hassle
      disableBiometricLock();
      setEnabled(false);
    } else {
      // 1-tap enable: directly prompts the device Face ID / Fingerprint sensor
      setLoading(true);
      try {
        const res = await registerBiometrics(userName);
        if (res.success) {
          setEnabled(true);
        } else {
          setError(
            res.error ||
              (lang === "fr"
                ? "Scan biométrique annulé ou non reconnu."
                : "Biometric scan cancelled or not recognized.")
          );
        }
      } catch {
        setError(
          lang === "fr"
            ? "Impossible d'activer la biométrie."
            : "Could not activate biometrics."
        );
      } finally {
        setLoading(false);
      }
    }
  }

  if (!mounted) return null;

  return (
    <div className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-colors ${
              enabled
                ? "bg-emerald-50 text-emerald-600"
                : "bg-primary/10 text-primary"
            }`}
          >
            <span className="material-symbols-outlined text-2xl">{bioIcon}</span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-label-md text-label-md text-on-surface font-semibold truncate">
                {lang === "fr"
                  ? `Verrouillage ${bioLabel}`
                  : `${bioLabel} Lock`}
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
                  ? `Protégé par votre ${bioLabel} dès que vous quittez l'écran`
                  : `Protected with your ${bioLabel} when leaving the screen`
                : lang === "fr"
                ? `Déverrouiller facilement avec votre ${bioLabel}`
                : `Unlock easily using your ${bioLabel}`}
            </p>
          </div>
        </div>

        {/* 1-Tap Toggle: launches native Face ID / Fingerprint sensor */}
        <button
          type="button"
          role="switch"
          disabled={loading}
          aria-checked={enabled}
          onClick={handleToggle}
          aria-label={
            lang === "fr"
              ? `Activer ou désactiver le verrouillage par ${bioLabel}`
              : `Toggle ${bioLabel} lock`
          }
          className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 ${
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

      {loading && (
        <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center gap-2 text-xs text-primary font-medium">
          <span className="material-symbols-outlined text-[16px] animate-spin">
            progress_activity
          </span>
          <span>
            {lang === "fr"
              ? `Veuillez scanner votre ${bioLabel} sur votre appareil...`
              : `Please scan your ${bioLabel} on your device...`}
          </span>
        </div>
      )}

      {error && !loading && (
        <p className="mt-2 text-xs text-error font-medium">{error}</p>
      )}
    </div>
  );
}
