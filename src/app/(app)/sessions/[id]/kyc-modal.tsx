"use client";

import { useState, useEffect } from "react";
import { translate, translateIfKnown, type Lang, type TranslationKey } from "@/lib/i18n/translations";
import { parseJsonOrThrow, friendlyErrorMessage } from "@/lib/api-error";
import { compressImage, formatImageSize, ImageTooLargeError, MAX_OUTPUT_BYTES } from "@/lib/compress-image";
import { SelfieCameraModal } from "@/components/selfie-camera-modal";

const FIELD_LABEL_KEY: Record<string, TranslationKey> = {
  selfieImage: "selfiePhotoLabel",
};

export function KycModal({
  tontineSessionId,
  onClose,
  lang,
}: {
  tontineSessionId: string;
  onClose: () => void;
  lang: Lang;
}) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const [selfieFile, setSelfieFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showCameraModal, setShowCameraModal] = useState(false);
  const [applicantFullName, setApplicantFullName] = useState("");
  const [referrerName, setReferrerName] = useState("");
  const [residenceCity, setResidenceCity] = useState("");
  const [residenceNeighborhood, setResidenceNeighborhood] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selfieFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(selfieFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selfieFile]);

  const canSubmit =
    selfieFile &&
    applicantFullName.trim() &&
    referrerName.trim() &&
    residenceCity.trim() &&
    residenceNeighborhood.trim();

  function translateServerError(key: string, vars?: Record<string, string>): string | undefined {
    const merged = { ...vars };
    if (merged.field && merged.field in FIELD_LABEL_KEY) {
      merged.document = t(FIELD_LABEL_KEY[merged.field]);
    }
    return translateIfKnown(lang, key, merged);
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    if (!applicantFullName.trim()) {
      setError(t("applicantFullNameRequired"));
      return;
    }
    if (!referrerName.trim()) {
      setError(t("referrerNameRequired"));
      return;
    }
    if (!residenceCity.trim()) {
      setError(t("residenceCityRequired"));
      return;
    }
    if (!residenceNeighborhood.trim()) {
      setError(t("residenceNeighborhoodRequired"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const toCompress: { key: "selfieImage"; file: File }[] = [
        { key: "selfieImage", file: selfieFile },
      ];
      const compressed = await Promise.allSettled(toCompress.map(({ file }) => compressImage(file)));
      const failedIndex = compressed.findIndex((r) => r.status === "rejected");
      if (failedIndex !== -1) {
        const reason = (compressed[failedIndex] as PromiseRejectedResult).reason;
        const size = reason instanceof ImageTooLargeError ? formatImageSize(reason.sizeBytes) : "?";
        setError(t("kycCompressionFailed", { document: t("selfiePhotoLabel"), size, max: formatImageSize(MAX_OUTPUT_BYTES) }));
        setSubmitting(false);
        return;
      }

      const formData = new FormData();
      // Send SELFIE as document type — server accepts this for selfie-only flow
      formData.append("documentType", "SELFIE");
      const selfieBlob = (compressed[0] as PromiseFulfilledResult<Blob>).value;
      formData.append("selfieImage", selfieBlob, "selfieImage.jpg");
      formData.append("applicantFullName", applicantFullName.trim());
      formData.append("referrerName", referrerName.trim());
      // Send a placeholder for referrerPhone since the backend still expects it
      formData.append("referrerPhone", "000000000");
      formData.append("residenceCity", residenceCity.trim());
      formData.append("residenceNeighborhood", residenceNeighborhood.trim());

      const res = await fetch(`/api/sessions/${tontineSessionId}/kyc`, {
        method: "POST",
        body: formData,
      });
      await parseJsonOrThrow(res, t("couldNotSubmitDocuments"));
      window.location.reload();
    } catch (err) {
      setError(friendlyErrorMessage(err, t("couldNotSubmitDocuments"), translateServerError));
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-container-padding bg-black/50">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl max-h-[calc(100dvh-7rem)] flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-primary">verified_user</span>
            <h2 className="font-title-md text-title-md text-on-surface">{t("identityVerification")}</h2>
          </div>
          <p className="font-body-md text-body-md text-on-surface-variant mb-stack-gap-md">
            {t("identityVerificationBodySimplified")}
          </p>

          <div className="flex flex-col gap-stack-gap-sm">
            {/* 1. Nom complet de l'utilisateur pour la cotisation */}
            <div>
              <label htmlFor="applicant-full-name" className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
                {t("applicantFullNameLabel")} <span className="text-error font-bold">*</span>
              </label>
              <input
                id="applicant-full-name"
                type="text"
                required
                value={applicantFullName}
                onChange={(e) => setApplicantFullName(e.target.value)}
                placeholder={t("applicantFullNamePlaceholder")}
                className="w-full border border-outline-variant rounded-lg px-3 py-2.5 font-body-md text-body-md text-on-surface focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
              />
            </div>

            {/* 2. Nom de la personne qui a parlé de la cotisation */}
            <div>
              <label htmlFor="referrer-name" className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
                {t("referrerNameLabel")} <span className="text-error font-bold">*</span>
              </label>
              <input
                id="referrer-name"
                type="text"
                required
                value={referrerName}
                onChange={(e) => setReferrerName(e.target.value)}
                placeholder={t("referrerNamePlaceholder")}
                className="w-full border border-outline-variant rounded-lg px-3 py-2.5 font-body-md text-body-md text-on-surface focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
              />
            </div>

            {/* 3. Ville */}
            <div>
              <label htmlFor="residence-city" className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
                {t("residenceCityLabel")} <span className="text-error font-bold">*</span>
              </label>
              <input
                id="residence-city"
                type="text"
                required
                value={residenceCity}
                onChange={(e) => setResidenceCity(e.target.value)}
                placeholder={t("residenceCityPlaceholder")}
                className="w-full border border-outline-variant rounded-lg px-3 py-2.5 font-body-md text-body-md text-on-surface focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
              />
            </div>

            {/* 4. Quartier */}
            <div>
              <label htmlFor="residence-neighborhood" className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
                {t("residenceNeighborhoodLabel")} <span className="text-error font-bold">*</span>
              </label>
              <input
                id="residence-neighborhood"
                type="text"
                required
                value={residenceNeighborhood}
                onChange={(e) => setResidenceNeighborhood(e.target.value)}
                placeholder={t("residenceNeighborhoodPlaceholder")}
                className="w-full border border-outline-variant rounded-lg px-3 py-2.5 font-body-md text-body-md text-on-surface focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
              />
            </div>

            {/* 5. Photo selfie avec caméra avant et accès galerie intégré */}
            <div>
              <p className="font-label-sm text-label-sm text-on-surface-variant mb-1.5">
                {t("selfiePhotoLabel")} <span className="text-error font-bold">*</span>
              </p>
              <p className="font-label-sm text-[11px] text-on-surface-variant mb-2">
                {t("selfiePhotoInstruction")}
              </p>

              {!selfieFile ? (
                <button
                  type="button"
                  onClick={() => setShowCameraModal(true)}
                  className="w-full flex items-center justify-between p-3.5 rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 hover:bg-primary/10 active:scale-[0.99] transition-all cursor-pointer text-left group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-full bg-primary/15 text-primary flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform">
                      <span className="material-symbols-outlined text-[24px]">photo_camera</span>
                    </div>
                    <div>
                      <p className="font-label-md text-label-md text-primary font-bold">
                        {t("takePhotoAction")}
                      </p>
                      <p className="text-[11px] text-on-surface-variant">
                        {lang === "fr"
                          ? "Caméra avant avec accès direct à votre galerie"
                          : "Front camera with direct gallery access"}
                      </p>
                    </div>
                  </div>
                  <span className="material-symbols-outlined text-primary text-[20px] group-hover:translate-x-0.5 transition-transform">
                    arrow_forward_ios
                  </span>
                </button>
              ) : (
                <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-emerald-200 bg-emerald-50/60 shadow-xs">
                  <div className="flex items-center gap-3 min-w-0">
                    {previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={previewUrl}
                        alt="Aperçu selfie"
                        className="w-12 h-12 rounded-lg object-cover border border-emerald-300 flex-shrink-0 shadow-xs"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center flex-shrink-0">
                        <span className="material-symbols-outlined text-2xl">check_circle</span>
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1 text-emerald-800 font-bold text-xs">
                        <span className="material-symbols-outlined text-[16px]">check_circle</span>
                        <span>{t("photoReady")}</span>
                      </div>
                      <p className="text-[11px] text-on-surface-variant truncate max-w-[150px]">
                        {selfieFile.name}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => setShowCameraModal(true)}
                      className="px-2.5 py-1.5 rounded-lg border border-primary/30 text-primary bg-white text-xs font-semibold hover:bg-primary/5 active:scale-95 transition-all"
                    >
                      {t("retakePhotoAction")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelfieFile(null)}
                      className="w-7 h-7 rounded-lg text-rose-600 hover:bg-rose-50 flex items-center justify-center transition-colors"
                      title={t("cancel")}
                    >
                      <span className="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex-shrink-0 p-5 pt-3 border-t border-surface-variant">
          {canSubmit && !error && (
            <p className="font-label-sm text-[11px] text-on-surface-variant mb-stack-gap-sm flex items-start gap-1.5">
              <span className="material-symbols-outlined text-[14px] flex-shrink-0 mt-0.5">summarize</span>
              {t("kycSubmissionSummarySimplified", { name: applicantFullName.trim(), referrer: referrerName.trim() })}
            </p>
          )}
          {error && <p className="font-label-sm text-label-sm text-error mb-stack-gap-sm">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 py-2.5 rounded-lg border border-outline-variant text-on-surface-variant font-label-md text-label-md hover:bg-surface-container-low transition-all disabled:opacity-60"
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !canSubmit}
              className="flex-1 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 active:scale-95 transition-all disabled:opacity-60"
            >
              {submitting ? t("submittingEllipsis") : t("submitForReview")}
            </button>
          </div>
        </div>
      </div>

      {/* Camera capture modal with front camera and direct gallery access */}
      <SelfieCameraModal
        isOpen={showCameraModal}
        onClose={() => setShowCameraModal(false)}
        onPhotoSelected={(file) => setSelfieFile(file)}
        lang={lang}
      />
    </div>
  );
}
