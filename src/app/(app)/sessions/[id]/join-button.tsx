"use client";

import { useState } from "react";
import type { Lang } from "@/lib/i18n/translations";
import { KycModal } from "./kyc-modal";

export function JoinButton({
  tontineSessionId,
  label,
  lang,
}: {
  tontineSessionId: string;
  label: string;
  lang: Lang;
}) {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div>
      <button
        onClick={() => setModalOpen(true)}
        className="w-full bg-primary text-on-primary font-label-md text-label-md h-12 rounded-lg flex items-center justify-center gap-2 hover:opacity-90 active:scale-95 transition-all"
      >
        <span className="material-symbols-outlined">group_add</span>
        {label}
      </button>
      {modalOpen && (
        <KycModal tontineSessionId={tontineSessionId} onClose={() => setModalOpen(false)} lang={lang} />
      )}
    </div>
  );
}
