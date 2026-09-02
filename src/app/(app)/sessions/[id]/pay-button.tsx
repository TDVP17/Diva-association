"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PaymentConfirmDialog } from "@/components/payment-confirm-dialog";
import { translate, type Lang } from "@/lib/i18n/translations";
import { saveDraftContribution } from "@/lib/offline/db";

export function PayButton({
  membershipSlotId,
  beneficiaryName,
  amountLabel,
  description,
  defaultPhone,
  lang,
  lockedReason,
}: {
  membershipSlotId: string;
  /** Shown in the offline-draft banner (see OfflineDraftSync) so the member can tell which name it's for. */
  beneficiaryName: string;
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
  const [savedOffline, setSavedOffline] = useState(false);

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

  if (savedOffline) {
    return (
      <div className="flex flex-col items-end gap-1 max-w-[180px] text-right">
        <span className="px-3 py-1.5 rounded-lg bg-secondary-fixed-dim/20 text-on-secondary-fixed-variant font-label-sm text-label-sm flex items-center gap-1">
          <span className="material-symbols-outlined text-[16px]">cloud_done</span>
          {t("contributionSavedOfflineTitle")}
        </span>
      </div>
    );
  }

  async function handleTap() {
    // A Mobile Money payment needs a live USSD round-trip — there's no
    // quote to fetch and nothing to actually charge offline. Instead of
    // opening a dialog that would just fail, the intent is saved locally;
    // OfflineDraftSync prompts the member to review and confirm it (through
    // this exact same PaymentConfirmDialog, with a fresh quote) once
    // they're back online.
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await saveDraftContribution({
        id: membershipSlotId,
        membershipSlotId,
        beneficiaryName,
        sessionLabel: description,
        description,
        amountLabel,
        phone: defaultPhone ?? "",
        createdAt: new Date().toISOString(),
      });
      setSavedOffline(true);
      return;
    }
    setShowConfirm(true);
  }

  return (
    <div>
      <button
        onClick={handleTap}
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
