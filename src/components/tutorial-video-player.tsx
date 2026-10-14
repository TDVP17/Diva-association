"use client";

import { useState } from "react";
import { translate, type Lang } from "@/lib/i18n/translations";

// The source file lives at public/video aide.mp4 — the space must be
// percent-encoded for a valid URL.
const VIDEO_SRC = "/video%20aide.mp4";

export function TutorialVideoPlayer({
  lang,
  className,
}: {
  lang: Lang;
  className?: string;
}) {
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  const [errored, setErrored] = useState(false);

  if (errored) {
    return (
      <div
        className={`aspect-[9/16] max-h-[65vh] w-full max-w-[340px] mx-auto rounded-xl bg-surface-container-low flex items-center justify-center ${
          className ?? ""
        }`}
      >
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
      className={`w-full max-h-[65vh] max-w-[340px] aspect-[9/16] rounded-xl bg-black object-contain mx-auto shadow-md block ${
        className ?? ""
      }`}
      onError={() => setErrored(true)}
    >
      <source src={VIDEO_SRC} type="video/mp4" />
    </video>
  );
}
