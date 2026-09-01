"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PaymentConfirmDialog } from "@/components/payment-confirm-dialog";
import { translate, type Lang } from "@/lib/i18n/translations";

export function FinePayButton({
  fineId,
  description,
  defaultPhone,
  lang,
}: {
  fineId: string;
  description: string;
  defaultPhone?: string | null;
  lang: Lang;
}) {
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  const router = useRouter();
  const [showConfirm, setShowConfirm] = useState(false);

  return (
    <div>
      <button
        onClick={() => setShowConfirm(true)}
        className="px-3 py-1.5 rounded-lg bg-error text-on-error font-label-sm text-label-sm flex items-center gap-1 hover:opacity-90 active:scale-95 transition-all"
      >
        <span className="material-symbols-outlined text-[16px]">payments</span>
        {t("payThisFine")}
      </button>
      {showConfirm && (
        <PaymentConfirmDialog
          lang={lang}
          fineId={fineId}
          payEndpoint={`/api/fines/${fineId}/pay`}
          description={description}
          defaultPhone={defaultPhone}
          onSettled={() => router.refresh()}
          onClose={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
}
