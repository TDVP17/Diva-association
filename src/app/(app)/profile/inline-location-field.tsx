"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { translate, type Lang } from "@/lib/i18n/translations";
import { updateProfileAction, type ProfileFormState } from "./actions";

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 active:scale-95 transition-all disabled:opacity-60"
    >
      {label}
    </button>
  );
}

const initialState: ProfileFormState = {};

/** City/neighborhood are low-risk fields (unlike email/phone/password), so this skips the OTP gate entirely. */
export function InlineLocationField({
  city,
  neighborhood,
  lang,
}: {
  city: string | null;
  neighborhood: string | null;
  lang: Lang;
}) {
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(updateProfileAction, initialState);

  const [cityValue, setCityValue] = useState(city ?? "");
  const [neighborhoodValue, setNeighborhoodValue] = useState(neighborhood ?? "");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geoStatus, setGeoStatus] = useState<"idle" | "locating" | "done" | "error">("idle");
  const [geoMessage, setGeoMessage] = useState<string | null>(null);

  if (state.success && open) {
    router.refresh();
    setOpen(false);
  }

  const summary = [city, neighborhood].filter(Boolean).join(", ") || t("notSet");

  function handleEnableGeolocation() {
    if (!("geolocation" in navigator)) {
      setGeoStatus("error");
      setGeoMessage(t("geolocationUnsupported"));
      return;
    }
    setGeoStatus("locating");
    setGeoMessage(null);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setCoords({ lat, lng });
        try {
          const res = await fetch(`/api/profile/reverse-geocode?lat=${lat}&lng=${lng}`);
          if (res.ok) {
            const body = (await res.json()) as { city: string | null; neighborhood: string | null };
            if (body.city) setCityValue(body.city);
            if (body.neighborhood) setNeighborhoodValue(body.neighborhood);
          }
          setGeoStatus("done");
          setGeoMessage(t("geolocationCaptured"));
        } catch {
          // Coordinates were still captured even if the reverse-geocode lookup failed.
          setGeoStatus("done");
          setGeoMessage(t("geolocationCaptured"));
        }
      },
      (error) => {
        setGeoStatus("error");
        setGeoMessage(error.code === error.PERMISSION_DENIED ? t("geolocationDenied") : t("geolocationFailed"));
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return (
    <>
      <div className="flex justify-between items-center px-4 py-3">
        <span className="font-label-sm text-label-sm text-on-surface-variant">{t("locationLabel")}</span>
        <div className="flex items-center gap-2">
          <span className="font-label-md text-label-md text-on-surface">{summary}</span>
          <button
            onClick={() => setOpen(true)}
            className="p-1 text-outline hover:text-primary transition-colors"
            aria-label={t("locationLabel")}
          >
            <span className="material-symbols-outlined text-[18px]">edit</span>
          </button>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-container-padding bg-black/50">
          <div className="w-full max-w-sm bg-white rounded-2xl p-5 shadow-xl">
            <h2 className="font-title-md text-title-md text-on-surface mb-stack-gap-md">{t("locationLabel")}</h2>

            <button
              type="button"
              onClick={handleEnableGeolocation}
              disabled={geoStatus === "locating"}
              className="w-full mb-3 py-2.5 rounded-lg border border-primary text-primary font-label-md text-label-md hover:bg-primary/5 active:scale-95 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
            >
              <span className={`material-symbols-outlined text-[18px] ${geoStatus === "locating" ? "animate-spin" : ""}`}>
                {geoStatus === "locating" ? "progress_activity" : "my_location"}
              </span>
              {geoStatus === "locating" ? t("geolocationCapturing") : t("enableGeolocation")}
            </button>
            {geoMessage && (
              <p
                className={`font-label-sm text-label-sm mb-3 ${geoStatus === "error" ? "text-error" : "text-on-surface-variant"}`}
              >
                {geoMessage}
              </p>
            )}

            <form action={formAction} className="flex flex-col gap-3">
              <input type="hidden" name="latitude" value={coords ? String(coords.lat) : ""} />
              <input type="hidden" name="longitude" value={coords ? String(coords.lng) : ""} />
              <input
                name="city"
                value={cityValue}
                onChange={(e) => setCityValue(e.target.value)}
                placeholder={t("cityLabel")}
                className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
              />
              <input
                name="neighborhood"
                value={neighborhoodValue}
                onChange={(e) => setNeighborhoodValue(e.target.value)}
                placeholder={t("neighborhoodLabel")}
                className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
              />
              {state.error && <p className="font-label-sm text-label-sm text-error">{state.error}</p>}
              <SaveButton label={t("save")} />
            </form>
            <button
              onClick={() => setOpen(false)}
              className="w-full mt-3 py-2 rounded-lg border border-outline-variant text-on-surface-variant font-label-md text-label-md hover:bg-surface-container-low"
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
