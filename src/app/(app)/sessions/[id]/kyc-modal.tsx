"use client";

import { useState } from "react";
import { translate, type Lang } from "@/lib/i18n/translations";
import { parseJsonOrThrow, friendlyErrorMessage } from "@/lib/api-error";
import { compressImage } from "@/lib/compress-image";

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
  const [documentType, setDocumentType] = useState<"CNI" | "PASSPORT">("CNI");
  const [documentFrontFile, setDocumentFrontFile] = useState<File | null>(null);
  const [documentBackFile, setDocumentBackFile] = useState<File | null>(null);
  const [selfieFile, setSelfieFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCni = documentType === "CNI";
  const canSubmit = documentFrontFile && selfieFile && (!isCni || documentBackFile);

  async function handleSubmit() {
    if (!canSubmit || !documentFrontFile || !selfieFile) return;
    setSubmitting(true);
    setError(null);
    try {
      const [compressedFront, compressedSelfie, compressedBack] = await Promise.all([
        compressImage(documentFrontFile),
        compressImage(selfieFile),
        documentBackFile ? compressImage(documentBackFile) : Promise.resolve(null),
      ]);
      const formData = new FormData();
      formData.append("documentType", documentType);
      formData.append("documentImage", compressedFront, "document-front.jpg");
      formData.append("selfieImage", compressedSelfie, "selfie.jpg");
      if (compressedBack) {
        formData.append("documentBackImage", compressedBack, "document-back.jpg");
      }

      const res = await fetch(`/api/sessions/${tontineSessionId}/kyc`, {
        method: "POST",
        body: formData,
      });
      await parseJsonOrThrow(res, t("couldNotSubmitDocuments"));
      window.location.reload();
    } catch (err) {
      setError(friendlyErrorMessage(err, t("couldNotSubmitDocuments")));
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-container-padding bg-black/50">
      <div className="w-full max-w-sm bg-white rounded-2xl p-5 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center gap-2 mb-3">
          <span className="material-symbols-outlined text-primary">verified_user</span>
          <h2 className="font-title-md text-title-md text-on-surface">{t("identityVerification")}</h2>
        </div>
        <p className="font-body-md text-body-md text-on-surface-variant mb-stack-gap-md">
          {t("identityVerificationBody")}
        </p>

        <fieldset className="mb-stack-gap-md">
          <legend className="font-label-sm text-label-sm text-on-surface-variant mb-2">
            {t("documentTypeLabel")}
          </legend>
          <div className="flex gap-3">
            <label className="flex items-center gap-2 font-label-md text-label-md text-on-surface">
              <input
                type="radio"
                name="documentType"
                checked={documentType === "CNI"}
                onChange={() => setDocumentType("CNI")}
              />
              {t("cameroonianCni")}
            </label>
            <label className="flex items-center gap-2 font-label-md text-label-md text-on-surface">
              <input
                type="radio"
                name="documentType"
                checked={documentType === "PASSPORT"}
                onChange={() => {
                  setDocumentType("PASSPORT");
                  setDocumentBackFile(null);
                }}
              />
              {t("passport")}
            </label>
          </div>
        </fieldset>

        {isCni && (
          <p className="font-label-sm text-label-sm text-error mb-stack-gap-sm flex items-start gap-1.5">
            <span className="material-symbols-outlined text-[16px] flex-shrink-0 mt-0.5">info</span>
            {t("cniCountryWarning")}
          </p>
        )}

        <div className="flex flex-col gap-stack-gap-sm mb-stack-gap-md">
          <PhotoPicker
            label={isCni ? t("documentFrontPhotoLabel") : t("passportPhotoLabel")}
            file={documentFrontFile}
            onChange={setDocumentFrontFile}
            captureMode="environment"
            chooseLabel={t("choosePhotoAction")}
            selectedLabel={t("photoSelectedLabel")}
          />
          {isCni && (
            <PhotoPicker
              label={t("documentBackPhotoLabel")}
              file={documentBackFile}
              onChange={setDocumentBackFile}
              captureMode="environment"
              chooseLabel={t("choosePhotoAction")}
              selectedLabel={t("photoSelectedLabel")}
            />
          )}
          <PhotoPicker
            label={t("selfiePhotoLabel")}
            file={selfieFile}
            onChange={setSelfieFile}
            captureMode="user"
            chooseLabel={t("choosePhotoAction")}
            selectedLabel={t("photoSelectedLabel")}
          />
        </div>

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
  );
}

function PhotoPicker({
  label,
  file,
  onChange,
  captureMode,
  chooseLabel,
  selectedLabel,
}: {
  label: string;
  file: File | null;
  onChange: (file: File | null) => void;
  captureMode: "environment" | "user";
  chooseLabel: string;
  selectedLabel: string;
}) {
  return (
    <label className="flex items-center justify-between gap-3 border border-outline-variant rounded-lg px-3 py-2.5 cursor-pointer hover:bg-surface-container-low transition-colors">
      <div className="min-w-0">
        <p className="font-label-sm text-label-sm text-on-surface-variant">{label}</p>
        <p className="font-label-md text-label-md text-on-surface truncate">
          {file ? `${selectedLabel} — ${file.name}` : chooseLabel}
        </p>
      </div>
      <span className="material-symbols-outlined text-primary flex-shrink-0">
        {file ? "check_circle" : "add_a_photo"}
      </span>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture={captureMode}
        className="hidden"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
    </label>
  );
}
