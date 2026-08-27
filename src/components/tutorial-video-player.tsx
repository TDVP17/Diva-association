"use client";

import { useState } from "react";
import { translate, type Lang } from "@/lib/i18n/translations";

// The source file lives at public/video aide.mp4 — the space must be
// percent-encoded for a valid URL.
const VIDEO_SRC = "/video%20aide.mp4";

export function TutorialVideoPlayer({ lang }: { lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  const [errored, setErrored] = useState(false);

  if (errored) {
    return (
      <div className="aspect-video w-full rounded-xl bg-surface-container-low flex items-center justify-center">
        <p className="font-label-sm text-label-sm text-on-surface-variant px-4 text-center">
          {t("tutorialVideoUnavailable")}
        </p>
      </div>
    );
  }

  return (
    <video
      controls
      playsInline
      preload="metadata"
      className="w-full aspect-video rounded-xl bg-black"
      onError={() => setErrored(true)}
    >
      <source src={VIDEO_SRC} type="video/mp4" />
    </video>
  );
}
