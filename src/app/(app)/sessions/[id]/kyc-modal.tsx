"use client";

import { useState } from "react";
import { translate, translateIfKnown, type Lang, type TranslationKey } from "@/lib/i18n/translations";
import { parseJsonOrThrow, friendlyErrorMessage } from "@/lib/api-error";
import { compressImage, formatImageSize, ImageTooLargeError, MAX_OUTPUT_BYTES } from "@/lib/compress-image";

// Maps the server's/compressImage's field identifiers to the already-
// user-facing label for that photo, so a validation error can name exactly
// which of the 3 uploads failed ("Front of your CNI is too large…") in
// whichever language is currently selected — never a raw field name.
const FIELD_LABEL_KEY: Record<string, TranslationKey> = {
  documentImage: "documentFrontPhotoLabel",
  documentBackImage: "documentBackPhotoLabel",
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
  const [documentFrontFile, setDocumentFrontFile] = useState<File | null>(null);
  const [documentBackFile, setDocumentBackFile] = useState<File | null>(null);
  const [selfieFile, setSelfieFile] = useState<File | null>(null);
  const [referrerName, setReferrerName] = useState("");
  const [referrerPhone, setReferrerPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    documentFrontFile && documentBackFile && selfieFile && referrerName.trim() && referrerPhone.trim();

  // Resolves a server-supplied errorKey/errorVars into the specific,
  // localized message — e.g. "kycDocumentTooLarge" + {field, size, max}
  // becomes "Back of your CNI is too large (6.2MB). Please choose a photo
  // under 1.5MB…" — instead of the generic couldNotSubmitDocuments
  // fallback that used to be shown for every failure regardless of cause.
  function translateServerError(key: string, vars?: Record<string, string>): string | undefined {
    const merged = { ...vars };
    if (merged.field && merged.field in FIELD_LABEL_KEY) {
      merged.document = t(FIELD_LABEL_KEY[merged.field]);
    }
    return translateIfKnown(lang, key, merged);
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    if (!referrerName.trim()) {
      setError(t("referrerNameRequired"));
      return;
    }
    const referrerPhoneDigits = referrerPhone.replace(/\D/g, "");
    if (referrerPhoneDigits.length < 8 || referrerPhoneDigits.length > 15) {
      setError(t("referrerPhoneRequired"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const compressed = await Promise.allSettled([
        compressImage(documentFrontFile),
        compressImage(documentBackFile),
        compressImage(selfieFile),
      ]);
      const fields: { key: keyof typeof FIELD_LABEL_KEY; result: PromiseSettledResult<Blob> }[] = [
        { key: "documentImage", result: compressed[0] },
        { key: "documentBackImage", result: compressed[1] },
        { key: "selfieImage", result: compressed[2] },
      ];
      const failed = fields.find((f) => f.result.status === "rejected");
      if (failed && failed.result.status === "rejected") {
        const reason = failed.result.reason;
        const size = reason instanceof ImageTooLargeError ? formatImageSize(reason.sizeBytes) : "?";
        setError(
          t("kycCompressionFailed", {
            document: t(FIELD_LABEL_KEY[failed.key]),
            size,
            max: formatImageSize(MAX_OUTPUT_BYTES),
          }),
        );
        setSubmitting(false);
        return;
      }

      const [compressedFront, compressedBack, compressedSelfie] = fields.map(
        (f) => (f.result as PromiseFulfilledResult<Blob>).value,
      );

      const formData = new FormData();
      formData.append("documentImage", compressedFront, "document-front.jpg");
      formData.append("documentBackImage", compressedBack, "document-back.jpg");
      formData.append("selfieImage", compressedSelfie, "selfie.jpg");
      formData.append("referrerName", referrerName.trim());
      formData.append("referrerPhone", referrerPhoneDigits);

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
    // z-[60] — deliberately above BottomNav's z-50 (public/... bottom-nav.tsx
    // is fixed, z-50, and DOM-appears after page content) so this modal
    // always paints on top of it instead of the nav bar covering the modal's
    // own footer. max-h reserves room for the nav (h-20 + safe-area inset)
    // so the box itself never even reaches that far, on top of the z-index
    // guarantee — belt and suspenders after the buttons were getting hidden
    // behind the nav on short mobile viewports.
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-container-padding bg-black/50">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl max-h-[calc(100dvh-7rem)] flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-primary">verified_user</span>
            <h2 className="font-title-md text-title-md text-on-surface">{t("identityVerification")}</h2>
          </div>
          <p className="font-body-md text-body-md text-on-surface-variant mb-stack-gap-md">
            {t("identityVerificationBody")}
          </p>

          <p className="font-label-sm text-label-sm text-error mb-stack-gap-sm flex items-start gap-1.5">
            <span className="material-symbols-outlined text-[16px] flex-shrink-0 mt-0.5">info</span>
            {t("cniCountryWarning")}
          </p>
          <p className="font-label-sm text-label-sm text-error mb-stack-gap-md flex items-start gap-1.5 font-semibold">
            <span className="material-symbols-outlined text-[16px] flex-shrink-0 mt-0.5">contact_page</span>
            {t("cniBothSidesRequired")}
          </p>

          <div className="flex flex-col gap-stack-gap-sm mb-stack-gap-md">
            <PhotoPicker
              label={t("documentFrontPhotoLabel")}
              instruction={t("documentFrontPhotoInstruction")}
              file={documentFrontFile}
              onChange={setDocumentFrontFile}
              captureMode="environment"
              chooseLabel={t("choosePhotoAction")}
              selectedLabel={t("photoSelectedLabel")}
            />
            <PhotoPicker
              label={t("documentBackPhotoLabel")}
              instruction={t("documentBackPhotoInstruction")}
              file={documentBackFile}
              onChange={setDocumentBackFile}
              captureMode="environment"
              chooseLabel={t("choosePhotoAction")}
              selectedLabel={t("photoSelectedLabel")}
            />
            <PhotoPicker
              label={t("selfiePhotoLabel")}
              instruction={t("selfiePhotoInstruction")}
              file={selfieFile}
              onChange={setSelfieFile}
              captureMode="user"
              chooseLabel={t("choosePhotoAction")}
              selectedLabel={t("photoSelectedLabel")}
            />
          </div>

          <div className="flex flex-col gap-stack-gap-sm">
            <div>
              <label htmlFor="referrer-name" className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
                {t("referrerNameLabel")}
              </label>
              <input
                id="referrer-name"
                type="text"
                value={referrerName}
                onChange={(e) => setReferrerName(e.target.value)}
                placeholder={t("referrerNamePlaceholder")}
                className="w-full border border-outline-variant rounded-lg px-3 py-2.5 font-body-md text-body-md text-on-surface focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
              />
            </div>
            <div>
              <label htmlFor="referrer-phone" className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
                {t("referrerPhoneLabel")}
              </label>
              <input
                id="referrer-phone"
                type="tel"
                inputMode="tel"
                value={referrerPhone}
                onChange={(e) => setReferrerPhone(e.target.value)}
                placeholder={t("referrerPhonePlaceholder")}
                className="w-full border border-outline-variant rounded-lg px-3 py-2.5 font-body-md text-body-md text-on-surface focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
              />
            </div>
          </div>
        </div>

        <div className="flex-shrink-0 p-5 pt-3 border-t border-surface-variant">
          {canSubmit && !error && (
            <p className="font-label-sm text-[11px] text-on-surface-variant mb-stack-gap-sm flex items-start gap-1.5">
              <span className="material-symbols-outlined text-[14px] flex-shrink-0 mt-0.5">summarize</span>
              {t("kycSubmissionSummary", { referrer: referrerName.trim() })}
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

function PhotoPicker({
  label,
  instruction,
  file,
  onChange,
  captureMode,
  chooseLabel,
  selectedLabel,
}: {
  label: string;
  /** Shown once, before the field is filled — tells the member exactly what to photograph and how, instead of a bare "Document 1"-style label. */
  instruction: string;
  file: File | null;
  onChange: (file: File | null) => void;
  captureMode: "environment" | "user";
  chooseLabel: string;
  selectedLabel: string;
}) {
  return (
    <div>
      {!file && (
        <p className="font-label-sm text-[11px] text-on-surface-variant mb-1 px-0.5">{instruction}</p>
      )}
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
    </div>
  );
}
