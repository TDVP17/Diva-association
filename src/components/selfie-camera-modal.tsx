"use client";

import { useEffect, useRef, useState } from "react";
import { type Lang } from "@/lib/i18n/translations";

interface SelfieCameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPhotoSelected: (file: File) => void;
  lang?: Lang;
}

export function SelfieCameraModal({
  isOpen,
  onClose,
  onPhotoSelected,
  lang = "fr",
}: SelfieCameraModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [hasCamera, setHasCamera] = useState<boolean | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [capturing, setCapturing] = useState(false);

  // Stop camera tracks cleanly
  function stopStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }

  // Start camera with requested facingMode (defaults to front camera "user")
  async function startCamera(mode: "user" | "environment") {
    stopStream();
    setHasCamera(null);
    setCameraError(null);

    if (
      typeof window === "undefined" ||
      !navigator?.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      setHasCamera(false);
      setCameraError(
        lang === "fr"
          ? "La caméra n'est pas supportée par ce navigateur."
          : "Camera is not supported on this browser."
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: mode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setHasCamera(true);
      setFacingMode(mode);
    } catch (err: unknown) {
      console.warn("[SelfieCamera] getUserMedia failed:", err);
      setHasCamera(false);
      const isDenied =
        err instanceof DOMException &&
        (err.name === "NotAllowedError" || err.name === "PermissionDeniedError");
      setCameraError(
        isDenied
          ? lang === "fr"
            ? "Accès caméra refusé. Activez la caméra dans les réglages du navigateur ou choisissez une photo dans votre galerie."
            : "Camera permission denied. Allow camera in settings or pick from gallery."
          : lang === "fr"
          ? "Impossible d'activer la caméra avant. Vous pouvez utiliser votre galerie ci-dessous."
          : "Unable to activate front camera. You can use your gallery below."
      );
    }
  }

  // Handle open / close lifecycle
  useEffect(() => {
    if (isOpen) {
      startCamera("user");
    } else {
      stopStream();
      setHasCamera(null);
      setCameraError(null);
    }

    return () => {
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Flip front / back camera
  function handleFlipCamera() {
    const nextMode = facingMode === "user" ? "environment" : "user";
    startCamera(nextMode);
  }

  // Shutter snapshot
  function handleCaptureSnapshot() {
    if (!videoRef.current || capturing) return;
    setCapturing(true);

    try {
      const video = videoRef.current;
      const width = video.videoWidth || 640;
      const height = video.videoHeight || 480;

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        setCapturing(false);
        return;
      }

      // If user facing, mirror horizontally to match the selfie preview
      if (facingMode === "user") {
        ctx.translate(width, 0);
        ctx.scale(-1, 1);
      }

      ctx.drawImage(video, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (blob) {
            const fileName = `selfie_${Date.now()}.jpg`;
            const file = new File([blob], fileName, { type: "image/jpeg" });
            stopStream();
            onPhotoSelected(file);
            onClose();
          }
          setCapturing(false);
        },
        "image/jpeg",
        0.92
      );
    } catch (err) {
      console.error("[SelfieCamera] capture snapshot error:", err);
      setCapturing(false);
    }
  }

  // Gallery file selected
  function handleGalleryChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      stopStream();
      onPhotoSelected(file);
      onClose();
    }
    // reset input value so re-selecting same file triggers change
    e.target.value = "";
  }

  function handleCloseModal() {
    stopStream();
    onClose();
  }

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/90 flex flex-col items-center justify-between p-3 sm:p-5 select-none"
      role="dialog"
      aria-modal="true"
    >
      {/* Top Header Bar */}
      <div className="w-full max-w-md flex items-center justify-between text-white py-2 z-10">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-[22px]">photo_camera</span>
          <span className="font-semibold text-sm tracking-wide">
            {lang === "fr" ? "Prendre votre photo" : "Take your photo"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Flip camera button */}
          {hasCamera && (
            <button
              type="button"
              onClick={handleFlipCamera}
              className="w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 active:scale-95 text-white flex items-center justify-center transition-all"
              title={lang === "fr" ? "Changer de caméra" : "Switch camera"}
            >
              <span className="material-symbols-outlined text-[20px]">flip_camera_ios</span>
            </button>
          )}

          {/* Close button */}
          <button
            type="button"
            onClick={handleCloseModal}
            className="w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 active:scale-95 text-white flex items-center justify-center transition-all"
            title={lang === "fr" ? "Fermer" : "Close"}
          >
            <span className="material-symbols-outlined text-[22px]">close</span>
          </button>
        </div>
      </div>

      {/* Center Viewfinder / Camera Screen */}
      <div className="relative w-full max-w-md flex-1 my-2 rounded-3xl overflow-hidden bg-black flex items-center justify-center border border-white/10 shadow-2xl">
        {/* Hidden Gallery Input */}
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleGalleryChange}
        />

        {/* Video Element */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover ${
            facingMode === "user" ? "-scale-x-100" : ""
          }`}
        />

        {/* Loading Spinner */}
        {hasCamera === null && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 text-white gap-3 z-20">
            <span className="material-symbols-outlined text-4xl text-primary animate-spin">
              progress_activity
            </span>
            <p className="text-xs text-white/80">
              {lang === "fr" ? "Activation de la caméra avant..." : "Starting front camera..."}
            </p>
          </div>
        )}

        {/* Camera Permission / Error Fallback */}
        {hasCamera === false && (
          <div className="absolute inset-0 p-6 flex flex-col items-center justify-center text-center bg-slate-900/95 text-white gap-4 z-20">
            <div className="w-16 h-16 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl">no_photography</span>
            </div>
            <div>
              <p className="font-semibold text-sm text-white mb-1">
                {lang === "fr" ? "Caméra indisponible" : "Camera unavailable"}
              </p>
              <p className="text-xs text-white/70 max-w-xs leading-relaxed">
                {cameraError ||
                  (lang === "fr"
                    ? "Impossible d'accéder à la caméra avant."
                    : "Unable to access front camera.")}
              </p>
            </div>

            <button
              type="button"
              onClick={() => galleryInputRef.current?.click()}
              className="mt-2 px-5 py-3 rounded-xl bg-primary text-on-primary font-semibold text-xs flex items-center gap-2 shadow-lg hover:opacity-95 active:scale-95 transition-all"
            >
              <span className="material-symbols-outlined text-[18px]">photo_library</span>
              <span>
                {lang === "fr"
                  ? "Choisir une photo dans la galerie"
                  : "Pick photo from gallery"}
              </span>
            </button>
          </div>
        )}

        {/* Face framing oval guideline (visible when camera active) */}
        {hasCamera === true && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            {/* Oval overlay with subtle dashed border */}
            <div className="w-56 h-72 sm:w-64 sm:h-80 rounded-[48%] border-2 border-dashed border-white/60 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)] flex items-end justify-center pb-4 transition-all">
              <span className="px-3 py-1 rounded-full bg-black/60 backdrop-blur-xs text-white text-[11px] font-medium tracking-wide">
                {lang === "fr" ? "Cadrez votre visage" : "Center your face"}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Controls Bar */}
      <div className="w-full max-w-md py-3 px-4 flex items-center justify-between z-10">
        {/* Left: Gallery Direct Button */}
        <button
          type="button"
          onClick={() => galleryInputRef.current?.click()}
          className="flex flex-col items-center justify-center gap-1 text-white hover:text-primary active:scale-95 transition-all p-1"
          title={lang === "fr" ? "Choisir depuis la galerie" : "Pick from gallery"}
        >
          <div className="w-12 h-12 rounded-2xl bg-white/15 hover:bg-white/25 border border-white/30 backdrop-blur-md flex items-center justify-center shadow-md">
            <span className="material-symbols-outlined text-[24px]">photo_library</span>
          </div>
          <span className="text-[11px] font-medium text-white/90">
            {lang === "fr" ? "Galerie" : "Gallery"}
          </span>
        </button>

        {/* Center: Large Shutter Button */}
        <button
          type="button"
          onClick={handleCaptureSnapshot}
          disabled={!hasCamera || capturing}
          className="relative w-20 h-20 rounded-full border-4 border-white flex items-center justify-center p-1.5 shadow-2xl active:scale-90 disabled:opacity-40 transition-transform cursor-pointer"
          title={lang === "fr" ? "Prendre la photo" : "Take photo"}
        >
          <div className="w-full h-full rounded-full bg-white hover:bg-slate-100 transition-colors" />
        </button>

        {/* Right: Camera Info / Flip Shortcut */}
        <button
          type="button"
          onClick={handleFlipCamera}
          disabled={!hasCamera}
          className="flex flex-col items-center justify-center gap-1 text-white hover:text-primary active:scale-95 transition-all p-1 disabled:opacity-30"
          title={lang === "fr" ? "Basculer caméra" : "Flip camera"}
        >
          <div className="w-12 h-12 rounded-2xl bg-white/15 hover:bg-white/25 border border-white/30 backdrop-blur-md flex items-center justify-center shadow-md">
            <span className="material-symbols-outlined text-[24px]">cameraswitch</span>
          </div>
          <span className="text-[11px] font-medium text-white/90">
            {facingMode === "user"
              ? lang === "fr"
                ? "Avant"
                : "Front"
              : lang === "fr"
              ? "Arrière"
              : "Back"}
          </span>
        </button>
      </div>
    </div>
  );
}
