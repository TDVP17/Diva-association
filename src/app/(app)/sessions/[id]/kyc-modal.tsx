"use client";

import { useState, useEffect, useRef } from "react";
import { translate, translateIfKnown, type Lang, type TranslationKey } from "@/lib/i18n/translations";
import { parseJsonOrThrow, friendlyErrorMessage } from "@/lib/api-error";
import { compressImage, formatImageSize, ImageTooLargeError, MAX_OUTPUT_BYTES } from "@/lib/compress-image";
import { SelfieCameraModal } from "@/components/selfie-camera-modal";

const FIELD_LABEL_KEY: Record<string, TranslationKey> = {
  selfieImage: "selfiePhotoLabel",
  documentImage: "documentTypeCni",
};

interface ReferrerResult {
  id: string;
  name: string;
  maskedEmail: string;
  sessionLabel: string | null;
  image: string | null;
}

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
  const isFr = lang === "fr";

  // Form Fields
  const [applicantFullName, setApplicantFullName] = useState("");
  const [referrerQuery, setReferrerQuery] = useState("");
  const [selectedReferrer, setSelectedReferrer] = useState<ReferrerResult | null>(null);
  const [referrerSearchResults, setReferrerSearchResults] = useState<ReferrerResult[]>([]);
  const [isSearchingReferrer, setIsSearchingReferrer] = useState(false);
  const [showReferrerDropdown, setShowReferrerDropdown] = useState(false);
  const [referrerSearchError, setReferrerSearchError] = useState<string | null>(null);

  const [residenceCity, setResidenceCity] = useState("");
  const [residenceNeighborhood, setResidenceNeighborhood] = useState("");

  // Geolocation
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geoStatus, setGeoStatus] = useState<"idle" | "locating" | "success" | "error">("idle");
  const [geoError, setGeoError] = useState<string | null>(null);

  // Photos (Minimum 2 required)
  const [selfieFile, setSelfieFile] = useState<File | null>(null);
  const [selfiePreviewUrl, setSelfiePreviewUrl] = useState<string | null>(null);

  const [cniFrontFile, setCniFrontFile] = useState<File | null>(null);
  const [cniFrontPreviewUrl, setCniFrontPreviewUrl] = useState<string | null>(null);

  const [cniBackFile, setCniBackFile] = useState<File | null>(null);
  const [cniBackPreviewUrl, setCniBackPreviewUrl] = useState<string | null>(null);

  const [activeCameraTarget, setActiveCameraTarget] = useState<"selfie" | "cniFront" | "cniBack" | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRefFront = useRef<HTMLInputElement | null>(null);
  const fileInputRefBack = useRef<HTMLInputElement | null>(null);

  // Previews
  useEffect(() => {
    if (!selfieFile) {
      setSelfiePreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(selfieFile);
    setSelfiePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selfieFile]);

  useEffect(() => {
    if (!cniFrontFile) {
      setCniFrontPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(cniFrontFile);
    setCniFrontPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [cniFrontFile]);

  useEffect(() => {
    if (!cniBackFile) {
      setCniBackPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(cniBackFile);
    setCniBackPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [cniBackFile]);

  // Live referrer search debounced
  useEffect(() => {
    if (selectedReferrer && selectedReferrer.name === referrerQuery) {
      return;
    }

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    const trimmed = referrerQuery.trim();
    if (trimmed.length < 2) {
      setReferrerSearchResults([]);
      setShowReferrerDropdown(false);
      setReferrerSearchError(null);
      setSelectedReferrer(null);
      return;
    }

    setIsSearchingReferrer(true);
    setReferrerSearchError(null);

    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/members/search-referrer?q=${encodeURIComponent(trimmed)}`);
        if (!res.ok) throw new Error("Search failed");
        const data = (await res.json()) as { results: ReferrerResult[]; found: boolean };

        setReferrerSearchResults(data.results || []);
        setShowReferrerDropdown(true);

        if (!data.found || (data.results && data.results.length === 0)) {
          setReferrerSearchError(
            isFr
              ? "Ce membre n'existe pas. Entrez son email ou son nom complet enregistré sur DIVA Asso."
              : "This member does not exist. Enter their email or full name registered on DIVA Asso."
          );
        } else {
          setReferrerSearchError(null);
        }
      } catch {
        setReferrerSearchError(
          isFr
            ? "Erreur lors de la recherche du parrain. Veuillez réessayer."
            : "Error searching referrer. Please try again."
        );
      } finally {
        setIsSearchingReferrer(false);
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [referrerQuery, selectedReferrer, isFr]);

  // Location handler
  function handleCaptureLocation() {
    if (!("geolocation" in navigator)) {
      setGeoStatus("error");
      setGeoError(
        isFr
          ? "La géolocalisation n'est pas prise en charge sur cet appareil."
          : "Geolocation is not supported on this device."
      );
      return;
    }

    setGeoStatus("locating");
    setGeoError(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoStatus("success");
      },
      (err) => {
        setGeoStatus("error");
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? isFr
              ? "Accès à la position refusé. Veuillez autoriser la localisation dans les paramètres de votre navigateur."
              : "Location access denied. Please allow location access in your browser settings."
            : isFr
            ? "Impossible d'obtenir votre position. Veuillez réessayer."
            : "Could not determine your location. Please try again."
        );
      },
      { enableHighAccuracy: true, timeout: 12000 }
    );
  }

  // Count uploaded images
  const totalPhotosCount = (selfieFile ? 1 : 0) + (cniFrontFile ? 1 : 0) + (cniBackFile ? 1 : 0);
  const hasMinimumTwoPhotos = totalPhotosCount >= 2;

  const canSubmit =
    applicantFullName.trim() &&
    referrerQuery.trim() &&
    !referrerSearchError &&
    residenceCity.trim() &&
    residenceNeighborhood.trim() &&
    coords !== null &&
    hasMinimumTwoPhotos;

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
    if (!referrerQuery.trim() || referrerSearchError) {
      setError(
        isFr
          ? "Veuillez désigner un membre référent valide enregistré sur DIVA Asso."
          : "Please specify a valid referrer member registered on DIVA Asso."
      );
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
    if (!coords) {
      setError(
        isFr
          ? "Le partage de votre localisation est obligatoire pour rejoindre cette cotisation."
          : "Sharing your location is required to join this cotisation."
      );
      return;
    }
    if (!hasMinimumTwoPhotos) {
      setError(
        isFr
          ? "Veuillez fournir au minimum 2 photos : votre photo et votre CNI / récépissé (recto-verso)."
          : "Please provide at least 2 photos: your photo and your ID/receipt (recto-verso)."
      );
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      // Prepare files for compression
      const toCompress: { key: "selfieImage" | "documentImage" | "documentBackImage"; file: File }[] = [];
      if (selfieFile) toCompress.push({ key: "selfieImage", file: selfieFile });
      if (cniFrontFile) toCompress.push({ key: "documentImage", file: cniFrontFile });
      if (cniBackFile) toCompress.push({ key: "documentBackImage", file: cniBackFile });

      const compressed = await Promise.allSettled(toCompress.map(({ file }) => compressImage(file)));
      const failedIndex = compressed.findIndex((r) => r.status === "rejected");
      if (failedIndex !== -1) {
        const reason = (compressed[failedIndex] as PromiseRejectedResult).reason;
        const size = reason instanceof ImageTooLargeError ? formatImageSize(reason.sizeBytes) : "?";
        setError(t("kycCompressionFailed", { document: "photo", size, max: formatImageSize(MAX_OUTPUT_BYTES) }));
        setSubmitting(false);
        return;
      }

      const formData = new FormData();
      formData.append("documentType", cniBackFile ? "CNI" : "RECEPISSE");

      toCompress.forEach(({ key }, idx) => {
        const blob = (compressed[idx] as PromiseFulfilledResult<Blob>).value;
        formData.append(key, blob, `${key}.jpg`);
      });

      formData.append("applicantFullName", applicantFullName.trim());
      formData.append("referrerName", selectedReferrer ? selectedReferrer.name : referrerQuery.trim());
      formData.append("referrerPhone", "000000000");
      formData.append("residenceCity", residenceCity.trim());
      formData.append("residenceNeighborhood", residenceNeighborhood.trim());
      formData.append("latitude", String(coords.lat));
      formData.append("longitude", String(coords.lng));

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
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl max-h-[94vh] flex flex-col overflow-hidden text-left border border-outline-variant/30">
        {/* Header - Aligné à gauche & Vert foncé */}
        <div className="flex-shrink-0 px-4 py-3 sm:px-5 sm:py-3.5 border-b border-surface-variant flex items-center justify-between bg-surface-container-low/40">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[22px]">verified_user</span>
            <div>
              <h2 className="text-left font-title-sm text-sm sm:text-base text-primary font-bold tracking-tight">
                {t("identityVerification")}
              </h2>
              <p className="text-left text-[11px] text-on-surface-variant">
                {isFr
                  ? "Vérification sécurisée pour rejoindre cette cotisation"
                  : "Secure verification to join this cotisation"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="w-7 h-7 rounded-full text-on-surface-variant hover:bg-surface-variant/50 flex items-center justify-center transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {/* Scrollable Form Body - Compact */}
        <div className="flex-1 overflow-y-auto px-4 py-3 sm:px-5 sm:py-3.5 space-y-3">
          {/* 1. Votre nom complet */}
          <div>
            <label htmlFor="applicant-full-name" className="text-left block text-[11px] sm:text-xs font-semibold text-primary mb-1">
              {t("applicantFullNameLabel")} <span className="text-error font-bold">*</span>
            </label>
            <input
              id="applicant-full-name"
              type="text"
              required
              value={applicantFullName}
              onChange={(e) => setApplicantFullName(e.target.value)}
              placeholder={t("applicantFullNamePlaceholder")}
              className="w-full border border-outline-variant rounded-lg px-3 py-1.5 text-xs text-on-surface focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
            />
          </div>

          {/* 2. Membre référent (Nom ou Email avec recherche directe) */}
          <div className="relative">
            <label htmlFor="referrer-search-input" className="text-left block text-[11px] sm:text-xs font-semibold text-primary mb-1">
              {t("referrerNameLabel")} <span className="text-error font-bold">*</span>
            </label>
            <div className="relative">
              <input
                id="referrer-search-input"
                type="text"
                required
                value={referrerQuery}
                onChange={(e) => {
                  setReferrerQuery(e.target.value);
                  setSelectedReferrer(null);
                }}
                placeholder={isFr ? "Tapez le nom ou l'email du membre..." : "Type member name or email..."}
                className={`w-full border rounded-lg px-3 py-1.5 pr-8 text-xs text-on-surface focus:outline-none focus:ring-1 ${
                  selectedReferrer
                    ? "border-emerald-500 bg-emerald-50/30 text-emerald-900"
                    : referrerSearchError
                    ? "border-red-500 bg-red-50/20"
                    : "border-outline-variant focus:ring-primary focus:border-primary"
                }`}
              />
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center">
                {isSearchingReferrer ? (
                  <div className="w-3.5 h-3.5 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
                ) : selectedReferrer ? (
                  <span className="material-symbols-outlined text-emerald-600 text-[18px]">check_circle</span>
                ) : (
                  <span className="material-symbols-outlined text-outline text-[18px]">search</span>
                )}
              </div>
            </div>

            {/* Error Message if member not found */}
            {referrerSearchError && (
              <p className="text-[11px] text-red-600 mt-1 font-medium leading-tight">
                {referrerSearchError}
              </p>
            )}

            {/* Success validation pill */}
            {selectedReferrer && (
              <div className="mt-1 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-100/70 border border-emerald-300 text-emerald-800 text-[11px] font-semibold">
                <span className="material-symbols-outlined text-[14px]">verified</span>
                <span>
                  {selectedReferrer.name} {selectedReferrer.maskedEmail ? `(${selectedReferrer.maskedEmail})` : ""} — {isFr ? "Membre validé" : "Verified Member"}
                </span>
              </div>
            )}

            {/* Dropdown Suggestions */}
            {showReferrerDropdown && referrerSearchResults.length > 0 && !selectedReferrer && (
              <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-outline-variant rounded-xl shadow-lg max-h-48 overflow-y-auto divide-y divide-surface-variant">
                <div className="px-3 py-1 text-[10px] uppercase font-bold text-on-surface-variant bg-surface-container-low">
                  {isFr ? "Membres DIVA Asso trouvés :" : "Matching members found:"}
                </div>
                {referrerSearchResults.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setSelectedReferrer(m);
                      setReferrerQuery(m.name);
                      setShowReferrerDropdown(false);
                      setReferrerSearchError(null);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-emerald-50/70 transition-colors flex items-center justify-between gap-2"
                  >
                    <div>
                      <p className="text-xs font-bold text-on-surface">{m.name}</p>
                      <p className="text-[10px] text-on-surface-variant">
                        {m.maskedEmail} {m.sessionLabel ? `• ${m.sessionLabel}` : ""}
                      </p>
                    </div>
                    <span className="text-[10px] font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full flex-shrink-0">
                      {isFr ? "Sélectionner" : "Select"}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 3. Ville et Quartier (2 colonnes compactes) */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="residence-city" className="text-left block text-[11px] sm:text-xs font-semibold text-primary mb-1">
                {t("residenceCityLabel")} <span className="text-error font-bold">*</span>
              </label>
              <input
                id="residence-city"
                type="text"
                required
                value={residenceCity}
                onChange={(e) => setResidenceCity(e.target.value)}
                placeholder={t("residenceCityPlaceholder")}
                className="w-full border border-outline-variant rounded-lg px-2.5 py-1.5 text-xs text-on-surface focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
              />
            </div>
            <div>
              <label htmlFor="residence-neighborhood" className="text-left block text-[11px] sm:text-xs font-semibold text-primary mb-1">
                {t("residenceNeighborhoodLabel")} <span className="text-error font-bold">*</span>
              </label>
              <input
                id="residence-neighborhood"
                type="text"
                required
                value={residenceNeighborhood}
                onChange={(e) => setResidenceNeighborhood(e.target.value)}
                placeholder={t("residenceNeighborhoodPlaceholder")}
                className="w-full border border-outline-variant rounded-lg px-2.5 py-1.5 text-xs text-on-surface focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
              />
            </div>
          </div>

          {/* 4. Partager la localisation GPS (OBLIGATOIRE) */}
          <div className="p-2.5 rounded-xl border border-outline-variant/60 bg-surface-container-low/40">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[18px]">location_on</span>
                <div>
                  <p className="text-[11px] sm:text-xs font-bold text-primary">
                    {isFr ? "Localisation géographique" : "Geolocation Position"} <span className="text-error font-bold">*</span>
                  </p>
                  <p className="text-[10px] text-on-surface-variant">
                    {isFr
                      ? "Obligatoire : enregistrée pour la vérification du profil"
                      : "Mandatory: recorded for profile verification"}
                  </p>
                </div>
              </div>

              {coords ? (
                <div className="flex items-center gap-1 text-emerald-700 font-bold text-[11px] bg-emerald-100/80 px-2 py-1 rounded-md border border-emerald-300">
                  <span className="material-symbols-outlined text-[15px]">check_circle</span>
                  <span>{isFr ? "Partagée ✓" : "Captured ✓"}</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleCaptureLocation}
                  disabled={geoStatus === "locating"}
                  className="px-2.5 py-1 rounded-lg bg-primary hover:bg-[#064e3b] text-white text-[11px] font-semibold flex items-center gap-1 active:scale-95 transition-all shadow-xs"
                >
                  {geoStatus === "locating" ? (
                    <>
                      <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>{isFr ? "Capture..." : "Locating..."}</span>
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[14px]">my_location</span>
                      <span>{isFr ? "Partager ma position" : "Share Position"}</span>
                    </>
                  )}
                </button>
              )}
            </div>

            {coords && (
              <p className="text-[10px] text-emerald-800 mt-1 font-mono">
                GPS: {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
              </p>
            )}

            {geoError && (
              <p className="text-[11px] text-red-600 mt-1 font-medium leading-tight">
                {geoError}
              </p>
            )}
          </div>

          {/* 5. Documents & Photos (Votre photo + CNI Recto-Verso - Minimum 2 photos) */}
          <div className="space-y-2 pt-1 border-t border-surface-variant">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-left text-xs font-bold text-primary">
                  {isFr ? "Votre photo & CNI / Récépissé recto-verso" : "Your photo & ID / receipt recto-verso"} <span className="text-error font-bold">*</span>
                </p>
                <p className="text-left text-[10px] text-on-surface-variant">
                  {isFr
                    ? "Minimum 2 photos requises : votre photo + CNI recto"
                    : "Minimum 2 photos required: your selfie + ID front"}
                </p>
              </div>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  hasMinimumTwoPhotos
                    ? "bg-emerald-50 text-emerald-800 border-emerald-300"
                    : "bg-amber-50 text-amber-800 border-amber-300"
                }`}
              >
                {totalPhotosCount} / min. 2
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {/* Photo 1: Selfie */}
              <div className="p-2 bg-surface-container-low/50 rounded-xl border border-surface-variant flex flex-col justify-between">
                <div>
                  <p className="text-[11px] font-semibold text-on-surface mb-1 flex items-center justify-between">
                    <span>1. {isFr ? "Votre Photo (Selfie)" : "Your Selfie"}</span>
                    {selfieFile && <span className="material-symbols-outlined text-emerald-600 text-[14px]">check</span>}
                  </p>
                  {selfiePreviewUrl ? (
                    <div className="relative w-full h-16 rounded-lg overflow-hidden border border-emerald-300 mb-1.5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={selfiePreviewUrl} alt="Selfie" className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className="w-full h-16 rounded-lg border-2 border-dashed border-outline-variant flex flex-col items-center justify-center text-outline mb-1.5 bg-white">
                      <span className="material-symbols-outlined text-[20px]">person</span>
                      <span className="text-[9px]">{isFr ? "Photo nette" : "Clear photo"}</span>
                    </div>
                  )}
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setActiveCameraTarget("selfie")}
                    className="flex-1 py-1 rounded bg-primary text-white text-[10px] font-semibold hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-0.5"
                  >
                    <span className="material-symbols-outlined text-[12px]">photo_camera</span>
                    <span>{selfieFile ? (isFr ? "Changer" : "Change") : (isFr ? "Prendre" : "Take")}</span>
                  </button>
                  {selfieFile && (
                    <button
                      type="button"
                      onClick={() => setSelfieFile(null)}
                      className="px-1.5 py-1 rounded text-red-600 hover:bg-red-50 text-[10px]"
                    >
                      <span className="material-symbols-outlined text-[14px]">delete</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Photo 2: CNI / Récépissé Recto */}
              <div className="p-2 bg-surface-container-low/50 rounded-xl border border-surface-variant flex flex-col justify-between">
                <div>
                  <p className="text-[11px] font-semibold text-on-surface mb-1 flex items-center justify-between">
                    <span>2. {isFr ? "CNI / Récépissé (Recto)" : "ID / Receipt (Front)"}</span>
                    {cniFrontFile && <span className="material-symbols-outlined text-emerald-600 text-[14px]">check</span>}
                  </p>
                  {cniFrontPreviewUrl ? (
                    <div className="relative w-full h-16 rounded-lg overflow-hidden border border-emerald-300 mb-1.5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={cniFrontPreviewUrl} alt="CNI Recto" className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className="w-full h-16 rounded-lg border-2 border-dashed border-outline-variant flex flex-col items-center justify-center text-outline mb-1.5 bg-white">
                      <span className="material-symbols-outlined text-[20px]">badge</span>
                      <span className="text-[9px]">{isFr ? "Recto officiel" : "Front side"}</span>
                    </div>
                  )}
                </div>
                <div className="flex gap-1">
                  <input
                    ref={fileInputRefFront}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) setCniFrontFile(file);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRefFront.current?.click()}
                    className="flex-1 py-1 rounded bg-primary text-white text-[10px] font-semibold hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-0.5"
                  >
                    <span className="material-symbols-outlined text-[12px]">upload</span>
                    <span>{cniFrontFile ? (isFr ? "Changer" : "Change") : (isFr ? "Ajouter" : "Add")}</span>
                  </button>
                  {cniFrontFile && (
                    <button
                      type="button"
                      onClick={() => setCniFrontFile(null)}
                      className="px-1.5 py-1 rounded text-red-600 hover:bg-red-50 text-[10px]"
                    >
                      <span className="material-symbols-outlined text-[14px]">delete</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Photo 3: CNI Verso (Optionnel) */}
              <div className="p-2 bg-surface-container-low/50 rounded-xl border border-surface-variant flex flex-col justify-between">
                <div>
                  <p className="text-[11px] font-semibold text-on-surface mb-1 flex items-center justify-between">
                    <span>3. {isFr ? "CNI (Verso)" : "ID (Back)"}</span>
                    {cniBackFile && <span className="material-symbols-outlined text-emerald-600 text-[14px]">check</span>}
                  </p>
                  {cniBackPreviewUrl ? (
                    <div className="relative w-full h-16 rounded-lg overflow-hidden border border-emerald-300 mb-1.5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={cniBackPreviewUrl} alt="CNI Verso" className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className="w-full h-16 rounded-lg border-2 border-dashed border-outline-variant flex flex-col items-center justify-center text-outline mb-1.5 bg-white">
                      <span className="material-symbols-outlined text-[20px]">flip_to_back</span>
                      <span className="text-[9px]">{isFr ? "Verso CNI" : "Back side"}</span>
                    </div>
                  )}
                </div>
                <div className="flex gap-1">
                  <input
                    ref={fileInputRefBack}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) setCniBackFile(file);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRefBack.current?.click()}
                    className="flex-1 py-1 rounded bg-secondary-fixed text-primary text-[10px] font-semibold hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-0.5 border border-primary/20"
                  >
                    <span className="material-symbols-outlined text-[12px]">upload</span>
                    <span>{cniBackFile ? (isFr ? "Changer" : "Change") : (isFr ? "Ajouter" : "Add")}</span>
                  </button>
                  {cniBackFile && (
                    <button
                      type="button"
                      onClick={() => setCniBackFile(null)}
                      className="px-1.5 py-1 rounded text-red-600 hover:bg-red-50 text-[10px]"
                    >
                      <span className="material-symbols-outlined text-[14px]">delete</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer - Actions & Validation */}
        <div className="flex-shrink-0 px-4 py-2.5 sm:px-5 sm:py-3 border-t border-surface-variant bg-surface-container-low/30">
          {error && <p className="text-[11px] text-error font-semibold mb-2">{error}</p>}
          {!hasMinimumTwoPhotos && (
            <p className="text-[11px] text-amber-700 font-semibold mb-2 flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">warning</span>
              {isFr
                ? "Veuillez charger au minimum 2 photos (votre photo + CNI recto) pour soumettre."
                : "Please upload at least 2 photos (your photo + ID front) to submit."}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 py-2 rounded-xl border border-outline-variant text-on-surface-variant text-xs font-semibold hover:bg-surface-container-low transition-all disabled:opacity-60"
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !canSubmit}
              className="flex-1 py-2 rounded-xl bg-primary text-white text-xs font-bold hover:bg-[#064e3b] active:scale-95 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? t("submittingEllipsis") : isFr ? "Soumettre pour examen" : "Submit for Review"}
            </button>
          </div>
        </div>
      </div>

      {/* Camera Capture Modal */}
      {activeCameraTarget && (
        <SelfieCameraModal
          isOpen={true}
          onClose={() => setActiveCameraTarget(null)}
          onPhotoSelected={(file) => {
            if (activeCameraTarget === "selfie") setSelfieFile(file);
            else if (activeCameraTarget === "cniFront") setCniFrontFile(file);
            else if (activeCameraTarget === "cniBack") setCniBackFile(file);
            setActiveCameraTarget(null);
          }}
          lang={lang}
        />
      )}
    </div>
  );
}
