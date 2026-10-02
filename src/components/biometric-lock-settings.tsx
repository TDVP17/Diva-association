"use client";

import { useEffect, useState } from "react";
import {
  isBiometricLockEnabled,
  detectBiometricType,
  isPlatformBiometricAvailable,
  registerBiometrics,
  setBackupPin,
  disableBiometricLock,
  verifyBackupPin,
  hasBackupPin,
  type BiometricType,
} from "@/lib/biometrics";
import { type Lang } from "@/lib/i18n/translations";

export function BiometricLockSettings({
  userName,
  lang,
}: {
  userName: string;
  lang: Lang;
}) {
  const [enabled, setEnabled] = useState(false);
  const [bioType, setBioType] = useState<BiometricType>("generic");
  const [supported, setSupported] = useState(true);
  const [loading, setLoading] = useState(false);
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [showDisableModal, setShowDisableModal] = useState(false);
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [disablePin, setDisablePin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    setEnabled(isBiometricLockEnabled());
    setBioType(detectBiometricType());
    isPlatformBiometricAvailable().then((avail) => {
      // Even if false on desktop, on mobile devices it is dynamically supported
      setSupported(avail || typeof window !== "undefined");
    });
  }, []);

  const bioLabel =
    bioType === "face_id"
      ? "Face ID"
      : bioType === "touch_id"
        ? "Touch ID"
        : bioType === "fingerprint"
          ? (lang === "fr" ? "Empreinte digitale" : "Fingerprint")
          : (lang === "fr" ? "Biométrie" : "Biometrics");

  const bioIcon = bioType === "face_id" ? "face" : "fingerprint";

  async function handleToggleClick() {
    setError(null);
    setSuccessMsg(null);
    if (enabled) {
      setShowDisableModal(true);
    } else {
      setShowSetupModal(true);
      setPin("");
      setPinConfirm("");
    }
  }

  async function handleActivate(e: React.FormEvent) {
    e.preventDefault();
    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      setError(lang === "fr" ? "Le code PIN doit comporter 4 chiffres." : "PIN must be exactly 4 digits.");
      return;
    }
    if (pin !== pinConfirm) {
      setError(lang === "fr" ? "Les deux codes PIN ne correspondent pas." : "PIN confirmation does not match.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await registerBiometrics(userName);
      if (!res.success) {
        setError(
          res.error ||
            (lang === "fr"
              ? "L'enregistrement biométrique a échoué ou a été annulé."
              : "Biometric registration failed or was cancelled."),
        );
        setLoading(false);
        return;
      }

      await setBackupPin(pin);
      setEnabled(true);
      setShowSetupModal(false);
      setSuccessMsg(
        lang === "fr"
          ? `Verrouillage par ${bioLabel} activé avec succès !`
          : `Lock with ${bioLabel} enabled successfully!`,
      );
    } catch (err) {
      setError(
        lang === "fr"
          ? "Erreur lors de l'activation. Veuillez réessayer."
          : "Error during activation. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleDisable(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // If backup pin exists, verify it
    if (hasBackupPin()) {
      const valid = await verifyBackupPin(disablePin);
      if (!valid) {
        setError(lang === "fr" ? "Code PIN de sécurité incorrect." : "Incorrect security PIN.");
        setLoading(false);
        return;
      }
    }

    disableBiometricLock();
    setEnabled(false);
    setShowDisableModal(false);
    setDisablePin("");
    setLoading(false);
    setSuccessMsg(lang === "fr" ? "Verrouillage désactivé." : "Lock disabled.");
  }

  return (
    <div className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant p-4 mb-stack-gap-lg">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-[24px]">{bioIcon}</span>
          </div>
          <h3 className="font-label-md text-label-md font-bold text-on-surface truncate">
            {lang === "fr" ? "Verrouillage de l'application" : "App Screen Lock"}
          </h3>
        </div>

        {/* Toggle Switch */}
        <button
          type="button"
          onClick={handleToggleClick}
          role="switch"
          aria-checked={enabled}
          aria-label={lang === "fr" ? "Activer le verrouillage biométrique" : "Enable biometric lock"}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
            enabled ? "bg-emerald-600" : "bg-slate-300"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
              enabled ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {successMsg && (
        <div className="mt-3 p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
          <span className="material-symbols-outlined text-[16px] text-emerald-600">check_circle</span>
          <span>{successMsg}</span>
        </div>
      )}

      {/* Setup Modal */}
      {showSetupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl p-5 max-w-sm w-full shadow-2xl border border-slate-200 animate-scaleIn">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
                <span className="material-symbols-outlined text-[24px]">{bioIcon}</span>
              </div>
              <div>
                <h4 className="font-title-sm text-sm font-bold text-slate-900">
                  {lang === "fr" ? `Activer le verrouillage ${bioLabel}` : `Enable ${bioLabel} Lock`}
                </h4>
                <p className="text-xs text-slate-500">
                  {lang === "fr" ? "Protection biométrique & code PIN" : "Biometric & PIN security"}
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-600 mb-4 leading-relaxed">
              {lang === "fr"
                ? `Votre téléphone vous demandera de scanner votre ${bioLabel}. Définissez également un code PIN à 4 chiffres en cas d'indisponibilité du capteur.`
                : `Your device will ask to scan your ${bioLabel}. Also choose a 4-digit backup PIN in case biometrics are unavailable.`}
            </p>

            <form onSubmit={handleActivate} className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {lang === "fr" ? "Code PIN de secours (4 chiffres)" : "Backup PIN code (4 digits)"}
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  autoComplete="new-password"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  placeholder="••••"
                  required
                  className="w-full text-center tracking-widest text-lg font-bold rounded-lg border border-slate-300 py-2 focus:border-emerald-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {lang === "fr" ? "Confirmez le code PIN" : "Confirm PIN code"}
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  autoComplete="new-password"
                  value={pinConfirm}
                  onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  placeholder="••••"
                  required
                  className="w-full text-center tracking-widest text-lg font-bold rounded-lg border border-slate-300 py-2 focus:border-emerald-600 focus:outline-none"
                />
              </div>

              {error && <p className="text-xs text-red-600 font-medium">{error}</p>}

              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => setShowSetupModal(false)}
                  className="flex-1 py-2.5 rounded-lg border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50"
                >
                  {lang === "fr" ? "Annuler" : "Cancel"}
                </button>
                <button
                  type="submit"
                  disabled={loading || pin.length !== 4 || pinConfirm.length !== 4}
                  className="flex-1 py-2.5 rounded-lg bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-xs"
                >
                  {loading ? (
                    <span>{lang === "fr" ? "Scan..." : "Scanning..."}</span>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[16px]">{bioIcon}</span>
                      <span>{lang === "fr" ? "Activer" : "Enable"}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Disable Modal */}
      {showDisableModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl p-5 max-w-sm w-full shadow-2xl border border-slate-200 animate-scaleIn">
            <h4 className="font-title-sm text-sm font-bold text-slate-900 mb-2">
              {lang === "fr" ? "Désactiver le verrouillage" : "Disable Screen Lock"}
            </h4>
            <p className="text-xs text-slate-600 mb-4">
              {lang === "fr"
                ? "Entrez votre code PIN de sécurité pour désactiver le verrouillage de l'application."
                : "Enter your security PIN code to disable app locking."}
            </p>

            <form onSubmit={handleDisable} className="flex flex-col gap-3">
              <div>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  autoComplete="current-password"
                  value={disablePin}
                  onChange={(e) => setDisablePin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  placeholder="••••"
                  required
                  className="w-full text-center tracking-widest text-lg font-bold rounded-lg border border-slate-300 py-2 focus:border-emerald-600 focus:outline-none"
                />
              </div>

              {error && <p className="text-xs text-red-600 font-medium">{error}</p>}

              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => setShowDisableModal(false)}
                  className="flex-1 py-2.5 rounded-lg border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50"
                >
                  {lang === "fr" ? "Annuler" : "Cancel"}
                </button>
                <button
                  type="submit"
                  disabled={loading || disablePin.length !== 4}
                  className="flex-1 py-2.5 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 disabled:opacity-50"
                >
                  {loading ? (
                    <span>{lang === "fr" ? "Vérification..." : "Verifying..."}</span>
                  ) : (
                    <span>{lang === "fr" ? "Désactiver" : "Disable"}</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
