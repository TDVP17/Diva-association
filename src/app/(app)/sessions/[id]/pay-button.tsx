"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PaymentConfirmDialog } from "@/components/payment-confirm-dialog";
import { translate, type Lang } from "@/lib/i18n/translations";

export function PayButton({
  membershipSlotId,
  amountLabel,
  description,
  defaultPhone,
  lang,
  lockedReason,
}: {
  membershipSlotId: string;
  amountLabel: string;
  /** Shown in the confirm dialog as the payment's purpose, e.g. "Cotisation : Dimanche — 15 sept. 2026". */
  description: string;
  defaultPhone?: string | null;
  lang: Lang;
  /** Set when the round-robin lock blocks this cycle — disables the button up front instead of erroring after a tap. */
  lockedReason?: string;
}) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const router = useRouter();
  const [showConfirm, setShowConfirm] = useState(false);

  if (lockedReason) {
    return (
      <div className="flex flex-col items-end gap-1 max-w-[160px]">
        <button
          disabled
          className="px-3 py-1.5 rounded-lg bg-surface-variant text-on-surface-variant font-label-sm text-label-sm flex items-center gap-1 opacity-60 cursor-not-allowed"
        >
          <span className="material-symbols-outlined text-[16px]">lock</span>
          {t("payAmountButton", { amount: amountLabel })}
        </button>
        <p className="font-label-sm text-[11px] text-on-surface-variant text-right">{lockedReason}</p>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => setShowConfirm(true)}
        className="px-3 py-1.5 rounded-lg bg-primary text-on-primary font-label-sm text-label-sm flex items-center gap-1 hover:opacity-90 active:scale-95 transition-all"
      >
        <span className="material-symbols-outlined text-[16px]">payments</span>
        {t("payAmountButton", { amount: amountLabel })}
      </button>
      {showConfirm && (
        <PaymentConfirmDialog
          lang={lang}
          membershipSlotId={membershipSlotId}
          payEndpoint="/api/payments/fapshi/initiate"
          description={description}
          defaultPhone={defaultPhone}
          onSettled={() => router.refresh()}
          onClose={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
}
