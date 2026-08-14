"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Step = 1 | 2 | 3;

const STEP_LABELS: Record<Step, string> = {
  1: "ID Card",
  2: "Face Scan",
  3: "Address",
};

function StepIndicator({ step }: { step: Step }) {
  const progressPercent = step === 1 ? 0 : step === 2 ? 50 : 100;
  return (
    <div className="flex justify-between items-center mb-stack-gap-lg relative">
      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-1 bg-surface-variant rounded-full -z-10" />
      <div
        className="absolute left-0 top-1/2 -translate-y-1/2 h-1 bg-primary rounded-full -z-10 transition-all"
        style={{ width: `${progressPercent}%` }}
      />
      {([1, 2, 3] as Step[]).map((s) => (
        <div key={s} className="flex flex-col items-center gap-2">
          <div
            className={
              s < step
                ? "w-8 h-8 rounded-full bg-primary text-on-primary flex items-center justify-center font-label-md text-label-md shadow-sm"
                : s === step
                  ? "w-8 h-8 rounded-full bg-primary text-on-primary flex items-center justify-center font-label-md text-label-md shadow-md ring-4 ring-primary/20"
                  : "w-8 h-8 rounded-full bg-surface-variant text-outline flex items-center justify-center font-label-md text-label-md"
            }
          >
            {s < step ? <span className="material-symbols-outlined text-sm">check</span> : s}
          </div>
          <span
            className={
              s <= step
                ? "font-label-sm text-label-sm text-primary" + (s === step ? " font-bold" : "")
                : "font-label-sm text-label-sm text-outline"
            }
          >
            {STEP_LABELS[s]}
          </span>
        </div>
      ))}
    </div>
  );
}

function UploadTile({
  label,
  file,
  onChange,
}: {
  label: string;
  file: File | null;
  onChange: (file: File | null) => void;
}) {
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  return (
    <label className="relative flex flex-col items-center justify-center gap-2 aspect-[3/2] rounded-lg border-2 border-dashed border-outline-variant bg-surface-container-low cursor-pointer overflow-hidden hover:border-primary transition-colors">
      <input
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
      {previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={previewUrl} alt={label} className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <>
          <span className="material-symbols-outlined text-outline text-3xl">upload</span>
          <span className="font-label-sm text-label-sm text-on-surface-variant">{label}</span>
        </>
      )}
      {previewUrl && (
        <span className="absolute bottom-1 right-1 bg-surface/90 rounded-full p-1 text-primary shadow-sm">
          <span className="material-symbols-outlined text-[16px]">check_circle</span>
        </span>
      )}
    </label>
  );
}

function IdCardStep({
  idFront,
  idBack,
  setIdFront,
  setIdBack,
  onContinue,
}: {
  idFront: File | null;
  idBack: File | null;
  setIdFront: (f: File | null) => void;
  setIdBack: (f: File | null) => void;
  onContinue: () => void;
}) {
  return (
    <>
      <div className="bg-surface rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] p-stack-gap-md mb-stack-gap-lg border border-surface-variant">
        <div className="text-center mb-4">
          <h3 className="font-label-md text-label-md text-primary">National ID / Passport</h3>
          <p className="font-label-sm text-label-sm text-on-surface-variant">
            Upload clear photos of the front and back.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-stack-gap-md">
          <UploadTile label="Front side" file={idFront} onChange={setIdFront} />
          <UploadTile label="Back side" file={idBack} onChange={setIdBack} />
        </div>
      </div>
      <div className="flex gap-4 mb-stack-gap-lg">
        <button
          type="button"
          disabled={!idFront || !idBack}
          onClick={onContinue}
          className="flex-1 py-3 px-4 rounded-lg bg-primary text-on-primary font-label-md text-label-md text-center shadow-md hover:opacity-90 active:scale-95 transition-all disabled:opacity-40 disabled:pointer-events-none"
        >
          Continue to Face Scan
        </button>
      </div>
    </>
  );
}

function FaceScanStep({
  selfiePreview,
  onCapture,
  onRetake,
  onBack,
  onContinue,
}: {
  selfiePreview: string | null;
  onCapture: (blob: Blob) => void;
  onRetake: () => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (selfiePreview) return;
    let cancelled = false;

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "user" }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => {
        if (!cancelled) {
          setCameraError(
            "Camera access is required for live face verification. Please allow camera permission and reload.",
          );
        }
      });

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [selfiePreview, stopCamera]);

  function handleCapture() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (blob) onCapture(blob);
        stopCamera();
      },
      "image/jpeg",
      0.92,
    );
  }

  return (
    <>
      <div className="bg-surface rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] p-stack-gap-md mb-stack-gap-lg overflow-hidden relative border border-surface-variant">
        <div className="text-center mb-4">
          <h3 className="font-label-md text-label-md text-primary">Live Face Verification</h3>
          <p className="font-label-sm text-label-sm text-on-surface-variant">
            Position your face within the oval.
          </p>
        </div>
        <div className="relative w-full aspect-[3/4] bg-surface-container-high rounded-lg overflow-hidden mb-4">
          {selfiePreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={selfiePreview} alt="Captured selfie" className="absolute inset-0 w-full h-full object-cover" />
          ) : cameraError ? (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
              <p className="font-label-sm text-label-sm text-error">{cameraError}</p>
            </div>
          ) : (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-cover -scale-x-100"
            />
          )}
          {!selfiePreview && !cameraError && (
            <>
              <div className="absolute inset-0 border-[40px] border-surface/80 pointer-events-none" />
              <div className="absolute inset-0 m-auto w-3/4 h-3/4 border-2 border-secondary-fixed-dim rounded-full shadow-[0_0_0_9999px_rgba(248,249,250,0.85)] pointer-events-none" />
              <div className="absolute top-4 w-full text-center pointer-events-none">
                <span className="bg-surface/90 px-3 py-1 rounded-full font-label-sm text-label-sm text-primary shadow-sm inline-flex items-center gap-1 justify-center mx-auto w-max">
                  <span className="material-symbols-outlined text-[16px]">lightbulb</span> Good lighting
                </span>
              </div>
            </>
          )}
        </div>
        <canvas ref={canvasRef} className="hidden" />
        <div className="flex flex-col items-center gap-3">
          {selfiePreview ? (
            <button
              type="button"
              onClick={onRetake}
              className="py-2 px-5 rounded-full border-2 border-primary text-primary font-label-md text-label-md flex items-center gap-2 active:scale-95 transition-all"
            >
              <span className="material-symbols-outlined text-[18px]">refresh</span> Retake
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCapture}
              disabled={!!cameraError}
              className="w-16 h-16 rounded-full bg-primary text-on-primary flex items-center justify-center shadow-[0px_8px_30px_rgba(30,41,59,0.12)] hover:opacity-90 active:scale-95 transition-all ring-4 ring-primary/20 disabled:opacity-40"
            >
              <span className="material-symbols-outlined font-title-md text-title-md">photo_camera</span>
            </button>
          )}
          <span className="font-label-sm text-label-sm text-outline flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px]">lock</span> Live capture only. No gallery uploads.
          </span>
        </div>
      </div>
      <div className="flex gap-4 mb-stack-gap-lg">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 py-3 px-4 rounded-lg bg-transparent border-2 border-primary text-primary font-label-md text-label-md text-center hover:bg-surface-container-low transition-colors"
        >
          Back
        </button>
        <button
          type="button"
          disabled={!selfiePreview}
          onClick={onContinue}
          className="flex-[2] py-3 px-4 rounded-lg bg-primary text-on-primary font-label-md text-label-md text-center shadow-md hover:opacity-90 active:scale-95 transition-all disabled:opacity-40 disabled:pointer-events-none"
        >
          Continue to Address
        </button>
      </div>
    </>
  );
}

function AddressStep({
  city,
  neighborhood,
  phone,
  setCity,
  setNeighborhood,
  setPhone,
  onBack,
  onSubmit,
  submitting,
  error,
}: {
  city: string;
  neighborhood: string;
  phone: string;
  setCity: (v: string) => void;
  setNeighborhood: (v: string) => void;
  setPhone: (v: string) => void;
  onBack: () => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
}) {
  return (
    <>
      <div className="bg-surface rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] p-stack-gap-md mb-stack-gap-lg border border-surface-variant space-y-stack-gap-md">
        <div className="text-center mb-2">
          <h3 className="font-label-md text-label-md text-primary">Where are you based?</h3>
          <p className="font-label-sm text-label-sm text-on-surface-variant">
            Helps your community verify your local presence and reach you on WhatsApp.
          </p>
        </div>
        <div className="floating-label-group">
          <input
            className="floating-input"
            id="city"
            placeholder=" "
            required
            value={city}
            onChange={(e) => setCity(e.target.value)}
          />
          <label className="floating-label" htmlFor="city">
            City
          </label>
        </div>
        <div className="floating-label-group">
          <input
            className="floating-input"
            id="neighborhood"
            placeholder=" "
            required
            value={neighborhood}
            onChange={(e) => setNeighborhood(e.target.value)}
          />
          <label className="floating-label" htmlFor="neighborhood">
            Neighborhood
          </label>
        </div>
        <div className="floating-label-group">
          <input
            className="floating-input"
            id="phone"
            type="tel"
            placeholder=" "
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <label className="floating-label" htmlFor="phone">
            WhatsApp Number
          </label>
        </div>
      </div>
      {error && (
        <p className="font-label-sm text-label-sm text-error mb-stack-gap-md text-center">{error}</p>
      )}
      <div className="flex gap-4 mb-stack-gap-lg">
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          className="flex-1 py-3 px-4 rounded-lg bg-transparent border-2 border-primary text-primary font-label-md text-label-md text-center hover:bg-surface-container-low transition-colors disabled:opacity-40"
        >
          Back
        </button>
        <button
          type="button"
          disabled={!city.trim() || !neighborhood.trim() || !phone.trim() || submitting}
          onClick={onSubmit}
          className="flex-[2] py-3 px-4 rounded-lg bg-primary text-on-primary font-label-md text-label-md text-center shadow-md hover:opacity-90 active:scale-95 transition-all disabled:opacity-40 disabled:pointer-events-none"
        >
          {submitting ? "Submitting..." : "Submit for Review"}
        </button>
      </div>
    </>
  );
}

export function KycWizard({
  rejected,
  initialCity,
  initialNeighborhood,
  initialPhone,
}: {
  rejected: boolean;
  initialCity: string;
  initialNeighborhood: string;
  initialPhone: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [idFront, setIdFront] = useState<File | null>(null);
  const [idBack, setIdBack] = useState<File | null>(null);
  const [selfieBlob, setSelfieBlob] = useState<Blob | null>(null);
  const [selfiePreview, setSelfiePreview] = useState<string | null>(null);
  const [city, setCity] = useState(initialCity);
  const [neighborhood, setNeighborhood] = useState(initialNeighborhood);
  const [phone, setPhone] = useState(initialPhone);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleCapture(blob: Blob) {
    setSelfieBlob(blob);
    setSelfiePreview(URL.createObjectURL(blob));
  }

  function handleRetake() {
    if (selfiePreview) URL.revokeObjectURL(selfiePreview);
    setSelfieBlob(null);
    setSelfiePreview(null);
  }

  async function handleSubmit() {
    if (!idFront || !idBack || !selfieBlob) return;
    setSubmitting(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("idFront", idFront);
      formData.set("idBack", idBack);
      formData.set("selfie", selfieBlob, "selfie.jpg");
      formData.set("city", city.trim());
      formData.set("neighborhood", neighborhood.trim());
      formData.set("phone", phone.trim());

      const res = await fetch("/api/kyc/submit", { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Submission failed. Please try again.");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="px-container-padding pt-stack-gap-lg pb-section-margin max-w-md mx-auto min-h-screen">
      <div className="mb-stack-gap-lg">
        <h2 className="font-title-md text-title-md text-primary mb-2">Identity Verification</h2>
        <p className="font-body-md text-body-md text-on-surface-variant">
          {rejected
            ? "Your previous submission was rejected. Please resubmit clear, valid documents."
            : "To secure the community, please complete this mandatory step. Your data is encrypted and managed securely."}
        </p>
      </div>

      <StepIndicator step={step} />

      {step === 1 && (
        <IdCardStep
          idFront={idFront}
          idBack={idBack}
          setIdFront={setIdFront}
          setIdBack={setIdBack}
          onContinue={() => setStep(2)}
        />
      )}

      {step === 2 && (
        <FaceScanStep
          selfiePreview={selfiePreview}
          onCapture={handleCapture}
          onRetake={handleRetake}
          onBack={() => setStep(1)}
          onContinue={() => setStep(3)}
        />
      )}

      {step === 3 && (
        <AddressStep
          city={city}
          neighborhood={neighborhood}
          phone={phone}
          setCity={setCity}
          setNeighborhood={setNeighborhood}
          setPhone={setPhone}
          onBack={() => setStep(2)}
          onSubmit={handleSubmit}
          submitting={submitting}
          error={error}
        />
      )}
    </main>
  );
}
