"use client";

import { useState } from "react";
import { translate, type Lang } from "@/lib/i18n/translations";

export function AvatarViewer({
  avatarUrl,
  userName,
  lang,
  children,
}: {
  avatarUrl: string;
  userName: string;
  lang: Lang;
  children: React.ReactNode;
}) {
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={t("viewFullImage")} className="contents">
        {children}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-container-padding"
          onClick={() => setOpen(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={avatarUrl} alt={userName} className="max-w-full max-h-full object-contain rounded-lg" />
          <button
            onClick={() => setOpen(false)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20 transition-colors"
            aria-label="Close"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
      )}
    </>
  );
}
