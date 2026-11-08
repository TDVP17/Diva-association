"use client";

import { useEffect, useState } from "react";
import { translate, type Lang, type TranslationKey } from "@/lib/i18n/translations";
import { formatXAF } from "@/lib/format-currency";
import {
  resolveActiveFallbackMerchant,
  type FallbackPaymentConfigData,
} from "@/lib/fallback-ussd";

export interface FallbackPayableSlot {
  id: string;
  beneficiaryName: string;
  baseTotal: number;
  dueDate?: string | null;
}

interface PreviewImageItem {
  id: string;
  file: File;
  previewUrl: string;
}

const MAX_PROOF_IMAGES = 6;

export function NetworkFallbackProofStep({
  lang,
  operatorName,
  preferredProvider,
  failCount,
  payerPhone,
  availableSlots,
  defaultSelectedSlotIds,
  transId,
  onProofSubmitted,
  onClose,
  onDiscardDraft,
}: {
  lang: Lang;
  operatorName: string;
  preferredProvider: "ORANGE" | "MTN" | null;
  failCount: number;
  payerPhone: string;
  availableSlots: FallbackPayableSlot[];
  defaultSelectedSlotIds?: string[];
  transId?: string | null;
  onProofSubmitted: () => void;
  onClose: () => void;
  onDiscardDraft?: () => void;
}) {
  const t = (key: TranslationKey, vars?: Record<string, string>) =>
    translate(lang, key, vars);

  const [fallbackConfig, setFallbackConfig] = useState<FallbackPaymentConfigData | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [selectedProviderOverride, setSelectedProviderOverride] = useState<"ORANGE" | "MTN" | null>(
    null,
  );

  const [selectedSlotIds, setSelectedSlotIds] = useState<string[]>(() => {
    if (defaultSelectedSlotIds && defaultSelectedSlotIds.length > 0) {
      const valid = defaultSelectedSlotIds.filter((id) => availableSlots.some((s) => s.id === id));
      if (valid.length > 0) return valid;
    }
    return availableSlots.map((s) => s.id);
  });

  const [images, setImages] = useState<PreviewImageItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [proofError, setProofError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/payments/fallback-config")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: FallbackPaymentConfigData | null) => {
        if (cancelled) return;
        setFallbackConfig(data);
        setConfigLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setConfigLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      images.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedSlots = availableSlots.filter((s) => selectedSlotIds.includes(s.id));
  const totalAmount = selectedSlots.reduce((sum, s) => sum + s.baseTotal, 0);

  const effectivePreferred = selectedProviderOverride ?? preferredProvider;
  const isMerchantEnabled = fallbackConfig ? fallbackConfig.isEnabled !== false : false;
  const resolvedMerchant = isMerchantEnabled
    ? resolveActiveFallbackMerchant(fallbackConfig, effectivePreferred, totalAmount)
    : null;

  function toggleSlot(slotId: string) {
    setSelectedSlotIds((prev) => {
      if (prev.includes(slotId)) {
        if (prev.length <= 1) return prev;
        return prev.filter((id) => id !== slotId);
      }
      return [...prev, slotId];
    });
  }

  function handleFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const incoming = Array.from(fileList);
    setProofError(null);

    setImages((prev) => {
      const remainingCapacity = MAX_PROOF_IMAGES - prev.length;
      const toAdd = incoming.slice(0, Math.max(0, remainingCapacity)).map((file) => ({
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        previewUrl: URL.createObjectURL(file),
      }));
      if (incoming.length > remainingCapacity) {
        setProofError(
          lang === "fr"
            ? `Maximum ${MAX_PROOF_IMAGES} captures autorisées.`
            : `Maximum ${MAX_PROOF_IMAGES} screenshots allowed.`,
        );
      }
      return [...prev, ...toAdd];
    });

    e.target.value = "";
  }

  function removeImage(id: string) {
    setImages((prev) => {
      const removed = prev.find((item) => item.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((item) => item.id !== id);
    });
  }

  async function copyUssdCode(code: string) {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 3000);
    } catch {
      // ignore
    }
  }

  async function submitProofToDivaAsso() {
    if (images.length === 0 || selectedSlots.length === 0 || uploading) return;
    setUploading(true);
    setProofError(null);

    try {
      const fd = new FormData();
      for (const s of selectedSlots) {
        fd.append("membershipSlotIds", s.id);
      }
      if (selectedSlots.length === 1 && selectedSlots[0].dueDate) {
        fd.append("dueDate", selectedSlots[0].dueDate);
      }
      if (payerPhone) {
        fd.append("phone", payerPhone);
      }
      for (const img of images) {
        fd.append("files", img.file);
      }

      const res = await fetch("/api/payments/proof", {
        method: "POST",
        body: fd,
      });

      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setProofError(
          body?.error ||
            (lang === "fr"
              ? "Échec de l'envoi de la capture. Veuillez réessayer."
              : "Screenshot submission failed. Please try again."),
        );
        return;
      }

      onProofSubmitted();
    } catch (err) {
      console.error("[NetworkFallbackProofStep] upload error:", err);
      setProofError(
        lang === "fr"
          ? "Erreur de connexion. Veuillez réessayer."
          : "Network error. Please try again.",
      );
    } finally {
      setUploading(false);
    }
  }

  const isOrange = (resolvedMerchant?.provider ?? effectivePreferred) === "ORANGE";

  return (
    <div className="flex flex-col items-center gap-3 text-center w-full animate-in fade-in duration-200">
      {/* Icon + Operator Network notice */}
      <div className="w-full text-left p-3.5 rounded-xl border border-outline-variant bg-surface-container-low flex flex-col gap-1.5 shadow-2xs">
        <div className="flex items-center gap-2 text-on-surface">
          <span className="material-symbols-outlined text-primary text-[20px]">cell_tower</span>
          <span className="font-label-md text-xs sm:text-sm font-bold">
            {t("networkUnavailableTitle")}
          </span>
          {failCount > 0 && (
            <span className="ml-auto font-label-sm text-[10px] bg-black/5 text-on-surface-variant px-1.5 py-0.5 rounded-full font-medium">
              {t("failureAttemptCount", { count: String(failCount) })}
            </span>
          )}
        </div>
        <p className="font-body-md text-xs sm:text-sm text-on-surface leading-relaxed">
          {t("paymentFailedOperatorNetwork", { operator: operatorName })}
        </p>
      </div>

      {/* Multi-name selector */}
      {availableSlots.length > 0 && (
        <div className="w-full text-left p-3 rounded-xl border border-outline-variant bg-surface-container-low flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-on-surface">
              {t("namesToPayFallbackLabel", { count: String(selectedSlots.length) })}
            </span>
            <span className="text-xs font-black text-primary">
              {formatXAF(totalAmount)}
            </span>
          </div>

          {availableSlots.length > 1 ? (
            <div className="flex flex-col gap-1.5 max-h-32 overflow-y-auto pr-0.5">
              {availableSlots.map((slot) => {
                const checked = selectedSlotIds.includes(slot.id);
                return (
                  <label
                    key={slot.id}
                    className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                      checked
                        ? "border-primary/50 bg-white font-semibold text-on-surface"
                        : "border-outline-variant/50 bg-white/50 text-on-surface-variant"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSlot(slot.id)}
                        className="accent-primary rounded cursor-pointer flex-shrink-0"
                      />
                      <span className="truncate">{slot.beneficiaryName}</span>
                    </div>
                    <span className="font-bold flex-shrink-0">{formatXAF(slot.baseTotal)}</span>
                  </label>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center justify-between text-xs text-on-surface-variant">
              <span className="truncate font-medium">{availableSlots[0].beneficiaryName}</span>
              <span className="font-semibold text-on-surface">
                {t("fallbackTotalForNames", {
                  count: "1",
                  amount: formatXAF(totalAmount),
                })}
              </span>
            </div>
          )}
        </div>
      )}

      {/* CASE A: Merchant code IS ACTIVE & CONFIGURED */}
      {configLoaded && resolvedMerchant ? (
        <>
          <div
            className={`w-full text-left p-3.5 rounded-xl border-2 text-on-surface flex flex-col gap-2.5 shadow-sm ${
              isOrange
                ? "border-orange-400 bg-orange-50/70"
                : "border-amber-400 bg-amber-50/70"
            }`}
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span
                  className={`px-2 py-0.5 rounded font-label-sm text-[11px] font-bold ${
                    isOrange ? "bg-[#FF6600] text-white" : "bg-yellow-400 text-slate-950"
                  }`}
                >
                  {isOrange ? "Orange Money" : "MTN MoMo"}
                </span>
                <span
                  className={`font-label-md text-xs sm:text-sm font-bold ${
                    isOrange ? "text-orange-950" : "text-amber-950"
                  }`}
                >
                  {isOrange ? t("orangeMerchantCodeTitle") : t("mtnMerchantCodeTitle")}
                </span>
              </div>

              {resolvedMerchant.alternate && (
                <button
                  type="button"
                  onClick={() => setSelectedProviderOverride(resolvedMerchant.alternate!.provider)}
                  className="text-[11px] font-bold underline text-primary cursor-pointer"
                >
                  {resolvedMerchant.alternate.provider === "ORANGE" ? "Orange Money" : "MTN MoMo"}
                </button>
              )}
            </div>

            {resolvedMerchant.ussdCode && (
              <>
                <p className={`text-xs leading-snug ${isOrange ? "text-orange-900" : "text-amber-900"}`}>
                  {t("orangeMerchantCodeDesc")}
                </p>

                <div
                  className={`bg-white border-2 rounded-lg p-2.5 flex flex-wrap items-center justify-between gap-2 shadow-inner ${
                    isOrange ? "border-orange-300" : "border-amber-300"
                  }`}
                >
                  <code
                    className={`font-mono text-sm sm:text-base font-black tracking-wide select-all break-all min-w-0 ${
                      isOrange ? "text-orange-950" : "text-amber-950"
                    }`}
                  >
                    {resolvedMerchant.ussdCode}
                  </code>
                  <button
                    type="button"
                    onClick={() => copyUssdCode(resolvedMerchant.ussdCode)}
                    className={`px-2.5 py-1 rounded-md active:scale-95 text-xs font-bold transition-all flex items-center gap-1 flex-shrink-0 shadow-xs cursor-pointer ${
                      isOrange
                        ? "bg-orange-500 hover:bg-orange-600 text-white"
                        : "bg-amber-500 hover:bg-amber-600 text-slate-950"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[15px]">
                      {copiedCode ? "check" : "content_copy"}
                    </span>
                    <span>{copiedCode ? t("copied") : t("copy")}</span>
                  </button>
                </div>
              </>
            )}

            {resolvedMerchant.beneficiaryName && (
              <div
                className={`rounded-lg p-2 text-xs border ${
                  isOrange
                    ? "bg-orange-100/60 text-orange-950 border-orange-200"
                    : "bg-amber-100/60 text-amber-950 border-amber-200"
                }`}
              >
                <span className={`font-medium block ${isOrange ? "text-orange-800" : "text-amber-800"}`}>
                  {t("orangeMerchantBeneficiaryLabel")}
                </span>
                <span className="font-bold text-sm">{resolvedMerchant.beneficiaryName}</span>
              </div>
            )}
          </div>

          {/* Screenshot upload to DIVA Asso */}
          {availableSlots.length > 0 && (
            <div className="w-full text-left p-3.5 rounded-xl border border-outline-variant bg-surface-container-lowest flex flex-col gap-2.5 shadow-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-primary">
                  <span className="material-symbols-outlined text-lg">add_a_photo</span>
                  <span className="font-label-md text-xs sm:text-sm font-bold text-on-surface">
                    {t("uploadPaymentProofTitle")}
                  </span>
                </div>
                {images.length > 0 && (
                  <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                    {t("screenshotsSelectedCount", { count: String(images.length) })}
                  </span>
                )}
              </div>

              <p className="text-xs text-on-surface-variant leading-snug">
                {t("uploadPaymentProofDesc")}
              </p>

              <input
                id="proof-multi-upload-input"
                type="file"
                accept="image/*"
                multiple
                onChange={handleFilesSelected}
                className="hidden"
              />

              {images.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {images.map((img) => (
                    <div
                      key={img.id}
                      className="relative group rounded-lg overflow-hidden border border-outline-variant bg-surface aspect-square"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.previewUrl}
                        alt={img.file.name}
                        className="w-full h-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => removeImage(img.id)}
                        aria-label="Supprimer l'image"
                        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 hover:bg-error text-white flex items-center justify-center shadow-sm cursor-pointer transition-colors"
                      >
                        <span className="material-symbols-outlined text-[14px]">close</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {images.length < MAX_PROOF_IMAGES && (
                <label
                  htmlFor="proof-multi-upload-input"
                  className="w-full border-2 border-dashed border-outline-variant hover:border-primary p-3 rounded-lg text-center cursor-pointer transition-colors flex items-center justify-center gap-2 bg-surface text-on-surface-variant hover:text-primary"
                >
                  <span className="material-symbols-outlined text-xl">photo_camera</span>
                  <span className="font-label-sm text-xs font-semibold">
                    {images.length === 0
                      ? t("selectScreenshotsAction")
                      : t("addAnotherScreenshotAction")}
                  </span>
                </label>
              )}

              {proofError && <p className="text-xs text-error font-medium">{proofError}</p>}
            </div>
          )}

          <div className="flex gap-3 w-full pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={uploading}
              className="flex-1 px-3 py-2.5 rounded-lg border border-outline text-on-surface font-label-md text-xs sm:text-sm font-semibold hover:bg-surface-variant/50 transition-colors cursor-pointer disabled:opacity-50"
            >
              {t("cancelAction")}
            </button>
            <button
              type="button"
              onClick={submitProofToDivaAsso}
              disabled={images.length === 0 || uploading || selectedSlots.length === 0}
              className="flex-1 px-3 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-xs sm:text-sm font-bold hover:opacity-90 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">send</span>
              <span>{uploading ? t("proofSubmitting") : t("sendToAdminAction")}</span>
            </button>
          </div>
        </>
      ) : configLoaded ? (
        /* CASE B: Merchant code is DISABLED by admin or not available */
        <div className="w-full text-left p-4 rounded-xl border border-amber-300 bg-amber-50/70 flex flex-col gap-3 shadow-xs">
          <div className="flex items-center gap-2 text-amber-900 font-bold text-sm">
            <span className="material-symbols-outlined text-[20px] text-amber-700">info</span>
            <span>{lang === "fr" ? "Que faire maintenant ?" : "What to do now?"}</span>
          </div>

          <div className="flex flex-col gap-2.5 text-xs text-amber-950 leading-relaxed">
            <p className="font-medium">
              {lang === "fr"
                ? "Le paiement a échoué en raison d'une indisponibilité temporaire du réseau opérateur. Nous vous recommandons :"
                : "The payment could not proceed due to temporary operator network downtime. We recommend:"}
            </p>

            <div className="flex items-start gap-2 bg-white/80 p-2.5 rounded-lg border border-amber-200">
              <span className="material-symbols-outlined text-[18px] text-amber-700 shrink-0 mt-0.5">replay</span>
              <div>
                <strong>{lang === "fr" ? "1. Réessayer maintenant :" : "1. Retry now:"}</strong>{" "}
                {lang === "fr"
                  ? "Relancez le paiement, le signal USSD de votre opérateur peut être rétabli."
                  : "Trigger the payment prompt again; operator signal may be restored."}
              </div>
            </div>

            <div className="flex items-start gap-2 bg-white/80 p-2.5 rounded-lg border border-amber-200">
              <span className="material-symbols-outlined text-[18px] text-amber-700 shrink-0 mt-0.5">schedule</span>
              <div>
                <strong>{lang === "fr" ? "2. Réessayer plus tard :" : "2. Retry later:"}</strong>{" "}
                {lang === "fr"
                  ? "Attendez quelques minutes avant de valider votre cotisation."
                  : "Wait a few minutes before validating your contribution."}
              </div>
            </div>

            <div className="flex items-start gap-2 bg-white/80 p-2.5 rounded-lg border border-amber-200">
              <span className="material-symbols-outlined text-[18px] text-amber-700 shrink-0 mt-0.5">swap_horiz</span>
              <div>
                <strong>{lang === "fr" ? "3. Effectuer le paiement avec l'opérateur opposé :" : "3. Pay using opposing operator:"}</strong>{" "}
                {lang === "fr"
                  ? (effectivePreferred === "ORANGE"
                      ? "Si vous avez utilisé Orange Money, essayez d'effectuer le paiement avec un numéro MTN MoMo."
                      : "Si vous avez utilisé MTN MoMo, essayez d'effectuer le paiement avec un numéro Orange Money.")
                  : (effectivePreferred === "ORANGE"
                      ? "If you used Orange Money, try paying with an MTN MoMo number."
                      : "If you used MTN MoMo, try paying with an Orange Money number.")}
              </div>
            </div>
          </div>

          <div className="flex gap-2 w-full pt-2">
            <button
              type="button"
              onClick={onClose}
              className="w-full px-4 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-xs sm:text-sm font-bold hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">replay</span>
              <span>{lang === "fr" ? "Réessayer / Changer de numéro" : "Retry / Change number"}</span>
            </button>
          </div>
        </div>
      ) : null}

      {onDiscardDraft && (
        <button
          type="button"
          onClick={onDiscardDraft}
          className="text-error font-label-sm text-label-sm hover:underline flex items-center gap-1 mt-1"
        >
          <span className="material-symbols-outlined text-[16px]">delete</span>
          {t("deleteDraftAction")}
        </button>
      )}
      {transId && (
        <p className="font-label-sm text-[11px] text-on-surface-variant">Ref: {transId}</p>
      )}
    </div>
  );
}
