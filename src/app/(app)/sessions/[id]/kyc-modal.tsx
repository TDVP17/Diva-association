"use client";

import { useState } from "react";
import { translate, type Lang } from "@/lib/i18n/translations";
import { parseJsonOrThrow, friendlyErrorMessage } from "@/lib/api-error";

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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStart() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${tontineSessionId}/kyc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentType }),
      });
      const body = await parseJsonOrThrow<{ verificationUrl?: string }>(res, t("couldNotStartVerification"));
      if (!body.verificationUrl) throw new Error(t("couldNotStartVerification"));
      window.location.href = body.verificationUrl;
    } catch (err) {
      setError(friendlyErrorMessage(err, t("couldNotStartVerification")));
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-container-padding bg-black/50">
      <div className="w-full max-w-sm bg-white rounded-2xl p-5 shadow-xl">
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
                onChange={() => setDocumentType("PASSPORT")}
              />
              {t("passport")}
            </label>
          </div>
        </fieldset>

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
            onClick={handleStart}
            disabled={submitting}
            className="flex-1 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 active:scale-95 transition-all disabled:opacity-60"
          >
            {submitting ? t("startingEllipsis") : t("startVerification")}
          </button>
        </div>
      </div>
    </div>
  );
}
