"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Cropper, { type Area } from "react-easy-crop";
import { translate, type Lang } from "@/lib/i18n/translations";
import { getCroppedImageBlob } from "./crop-image";
import { AvatarViewer } from "./avatar-viewer";
import { parseJsonOrThrow, friendlyErrorMessage } from "@/lib/api-error";

export function AvatarUpload({
  currentAvatarUrl,
  userName,
  lang,
}: {
  currentAvatarUrl: string | null;
  userName: string;
  lang: Lang;
}) {
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [avatarUrl, setAvatarUrl] = useState(currentAvatarUrl);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCropSrc(URL.createObjectURL(file));
  }

  async function handleSaveCrop() {
    if (!cropSrc || !croppedAreaPixels) return;
    setUploading(true);
    setError(null);
    try {
      const blob = await getCroppedImageBlob(cropSrc, croppedAreaPixels);
      const formData = new FormData();
      formData.append("avatar", blob, "avatar.jpg");
      const res = await fetch("/api/profile/avatar", { method: "POST", body: formData });
      const body = await parseJsonOrThrow<{ avatarUrl: string }>(res, t("somethingWentWrong"));
      setAvatarUrl(body.avatarUrl);
      router.refresh();
      setCropSrc(null);
    } catch (err) {
      setError(friendlyErrorMessage(err, t("somethingWentWrong")));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-24 h-24">
        <AvatarViewer avatarUrl={avatarUrl ?? ""} userName={userName} lang={lang}>
          <div className="w-24 h-24 rounded-full border-2 border-secondary-fixed-dim overflow-hidden bg-surface-variant flex items-center justify-center">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt={userName} className="w-full h-full object-cover" />
            ) : (
              <span className="material-symbols-outlined text-4xl text-outline">person</span>
            )}
          </div>
        </AvatarViewer>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          aria-label="Change profile picture"
          className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-primary text-on-primary flex items-center justify-center shadow-md hover:opacity-90 active:scale-95 transition-all disabled:opacity-60"
        >
          <span className="material-symbols-outlined text-[18px]">photo_camera</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>
      {error && <p className="font-label-sm text-label-sm text-error mt-2">{error}</p>}

      {cropSrc && (
        <div className="fixed inset-0 z-[100] flex flex-col bg-black/90 p-container-padding">
          <div className="relative flex-1 min-h-0">
            <Cropper
              image={cropSrc}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="round"
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_, pixels) => setCroppedAreaPixels(pixels)}
            />
          </div>
          <div className="flex flex-col gap-3 pt-4">
            <input
              type="range"
              min={1}
              max={3}
              step={0.1}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-full"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setCropSrc(null)}
                disabled={uploading}
                className="flex-1 py-2.5 rounded-lg border-2 border-white/40 text-white font-label-md text-label-md disabled:opacity-60"
              >
                {t("cancel")}
              </button>
              <button
                onClick={handleSaveCrop}
                disabled={uploading || !croppedAreaPixels}
                className="flex-1 py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 disabled:opacity-60"
              >
                {uploading ? t("saving") : t("saveAvatar")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
