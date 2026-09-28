"use client";

import { useState } from "react";
import { translate, translateIfKnown, type Lang, type TranslationKey } from "@/lib/i18n/translations";
import { parseJsonOrThrow, friendlyErrorMessage } from "@/lib/api-error";
import { compressImage, formatImageSize, ImageTooLargeError, MAX_OUTPUT_BYTES } from "@/lib/compress-image";

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
  const [applicantFullName, setApplicantFullName] = useState("");
  const [referrerName, setReferrerName] = useState("");
  const [residenceCity, setResidenceCity] = useState("");
  const [residenceNeighborhood, setResidenceNeighborhood] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

            {/* 5. Photo/Selfie — se filmer ou upload de la galerie */}
            <div>
              <p className="font-label-sm text-label-sm text-on-surface-variant mb-1.5">
                {t("selfiePhotoLabel")} <span className="text-error font-bold">*</span>
              </p>
              <p className="font-label-sm text-[11px] text-on-surface-variant mb-2">
                {t("selfiePhotoInstruction")}
              </p>
              <div className="flex flex-col gap-2">
                {/* Option 1: Se filmer directement (caméra selfie) */}
                <label className="flex items-center justify-between gap-3 border border-outline-variant rounded-lg px-3 py-2.5 cursor-pointer hover:bg-surface-container-low transition-colors">
                  <div className="min-w-0 flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary flex-shrink-0">photo_camera</span>
                    <div>
                      <p className="font-label-md text-label-md text-on-surface">{t("takePhotoAction")}</p>
                      {selfieFile && (
                        <p className="font-label-sm text-[11px] text-on-surface-variant truncate">{selfieFile.name}</p>
                      )}
                    </div>
                  </div>
                  <span className="material-symbols-outlined text-primary flex-shrink-0">
                    {selfieFile ? "check_circle" : "add_a_photo"}
                  </span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    capture="user"
                    className="hidden"
                    onChange={(e) => setSelfieFile(e.target.files?.[0] ?? null)}
                  />
                </label>
                {/* Option 2: Upload depuis la galerie */}
                <label className="flex items-center justify-between gap-3 border border-outline-variant rounded-lg px-3 py-2.5 cursor-pointer hover:bg-surface-container-low transition-colors">
                  <div className="min-w-0 flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary flex-shrink-0">photo_library</span>
                    <div>
                      <p className="font-label-md text-label-md text-on-surface">{t("uploadFromGalleryAction")}</p>
                    </div>
                  </div>
                  <span className="material-symbols-outlined text-primary flex-shrink-0">upload</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => setSelfieFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
              {selfieFile && (
                <div className="mt-2 flex items-center gap-2 text-[#065f46] bg-[#d1fae5] rounded-lg px-3 py-2">
                  <span className="material-symbols-outlined text-[18px]">check_circle</span>
                  <span className="font-label-sm text-label-sm">{t("photoSelectedLabel")} — {selfieFile.name}</span>
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
    </div>
  );
}
