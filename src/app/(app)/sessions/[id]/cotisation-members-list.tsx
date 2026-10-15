"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { translate, type Lang } from "@/lib/i18n/translations";
import { PaymentConfirmDialog } from "@/components/payment-confirm-dialog";
import { BulkPaymentDialog } from "@/app/(app)/global-payment/bulk-payment-dialog";
import { saveDraftContribution } from "@/lib/offline/db";
import { playUiTapSound } from "@/lib/sound-effects";

export interface CotisationMemberItem {
  id: string;
  beneficiaryName: string;
  isMine: boolean;
  paid: boolean;
  paidAtLabel: string | null;
  paidByRelativeName?: string | null;
  fineAmount?: number | null;
  ballDrawn: number | null;
  officialPosition: number | null;
  userAvatar?: string | null;
}

const AVATAR_BG_COLORS = [
  "bg-amber-500",
  "bg-emerald-600",
  "bg-blue-600",
  "bg-pink-600",
  "bg-purple-600",
  "bg-teal-600",
  "bg-indigo-600",
  "bg-rose-600",
];

function getAvatarColor(name: string, index: number) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash + name.charCodeAt(i)) % AVATAR_BG_COLORS.length;
  }
  return AVATAR_BG_COLORS[(hash + index) % AVATAR_BG_COLORS.length];
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + (parts[parts.length - 1][0] ?? "")).toUpperCase();
}

export function CotisationMembersList({
  members,
  myUnpaidSlotIds,
  slotTotal,
  paymentDescription,
  defaultPhone,
  lang,
  isDraftSession,
  isBeneficiaryTurn,
  lockedReason,
}: {
  members: CotisationMemberItem[];
  myUnpaidSlotIds: string[];
  slotTotal: number;
  paymentDescription: string;
  defaultPhone?: string | null;
  lang: Lang;
  isDraftSession?: boolean;
  isBeneficiaryTurn?: boolean;
  lockedReason?: string;
}) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const router = useRouter();

  // Show only 3 members by default, expandable to show all
  const [showAllMembers, setShowAllMembers] = useState(false);

  // State for single-slot and bulk-slot payment dialogs
  const [activeSlotIdForPay, setActiveSlotIdForPay] = useState<string | null>(null);
  const [showBulkDialog, setShowBulkDialog] = useState(false);
  const [savedOffline, setSavedOffline] = useState(false);

  const hasUnpaid = myUnpaidSlotIds.length > 0;
  const displayedMembers = showAllMembers || members.length <= 3 ? members : members.slice(0, 3);

  async function handleMainCotiserAction() {
    playUiTapSound();
    if (lockedReason) return;
    if (!hasUnpaid) return;

    // Offline draft handling
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      for (const slotId of myUnpaidSlotIds) {
        const slot = members.find((m) => m.id === slotId);
        await saveDraftContribution({
          id: slotId,
          membershipSlotId: slotId,
          beneficiaryName: slot?.beneficiaryName ?? "Cotisation",
          sessionLabel: paymentDescription,
          description: paymentDescription,
          amountLabel: `${slotTotal} FCFA`,
          phone: defaultPhone ?? "",
          createdAt: new Date().toISOString(),
        });
      }
      setSavedOffline(true);
      return;
    }

    if (myUnpaidSlotIds.length > 1) {
      setShowBulkDialog(true);
    } else {
      setActiveSlotIdForPay(myUnpaidSlotIds[0]);
    }
  }

  function handlePaySingle(slotId: string) {
    playUiTapSound();
    if (lockedReason) return;
    setActiveSlotIdForPay(slotId);
  }

  return (
    <section className="mt-2">
      {/* Header: Membres + Tous vérifiés */}
      <div className="flex items-center justify-between gap-3 mb-2 px-1">
        <h2 className="text-base sm:text-lg font-bold text-slate-900">
          {lang === "fr" ? "Membres" : "Members"}
        </h2>
        <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200/80 text-xs font-semibold shadow-2xs">
          <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />
          <span>{t("allMembersVerified")}</span>
        </div>
      </div>

      {/* List container */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden divide-y divide-slate-100">
        {displayedMembers.map((slot, idx) => {
          const initials = getInitials(slot.beneficiaryName);
          const colorClass = getAvatarColor(slot.beneficiaryName, idx);

          return (
            <div
              key={slot.id}
              className="flex items-center justify-between p-3.5 sm:p-4 hover:bg-slate-50/50 transition-colors gap-3"
            >
              {/* Avatar + Info */}
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 shadow-2xs ${colorClass}`}
                >
                  {initials}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-slate-900 text-sm truncate leading-snug">
                    {slot.beneficiaryName}
                    {slot.isMine && (
                      <span className="text-primary font-bold ml-1">
                        {lang === "fr" ? "(toi)" : "(you)"}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-slate-500 font-medium flex items-center gap-1 mt-0.5">
                    <span className="text-emerald-600 font-bold text-xs">✓</span>
                    <span>{t("identityVerified")}</span>
                  </p>
                </div>
              </div>

              {/* Status Badge / Action */}
              <div className="flex-shrink-0">
                {slot.paid ? (
                  <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 font-bold text-xs shadow-2xs">
                    {t("paidBadge")}
                  </span>
                ) : slot.isMine ? (
                  <button
                    type="button"
                    onClick={() => handlePaySingle(slot.id)}
                    disabled={isDraftSession || slot.officialPosition === null || !!lockedReason}
                    className="px-3 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs shadow-xs transition-transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {lang === "fr" ? "Cotiser" : "Pay"}
                  </button>
                ) : (
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-slate-100 text-slate-500 font-medium text-xs">
                    {t("pendingBadge")}
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {/* Option Voir tout / Réduire */}
        {members.length > 3 && (
          <div>
            {!showAllMembers ? (
              <button
                type="button"
                onClick={() => {
                  playUiTapSound();
                  setShowAllMembers(true);
                }}
                className="w-full py-3 px-4 text-xs font-bold text-emerald-800 hover:text-emerald-900 bg-emerald-50/50 hover:bg-emerald-50/80 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <span>{t("seeAllMembers", { count: String(members.length) })}</span>
                <span className="material-symbols-outlined text-[16px]">expand_more</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  playUiTapSound();
                  setShowAllMembers(false);
                }}
                className="w-full py-3 px-4 text-xs font-bold text-slate-600 hover:text-slate-800 bg-slate-50 hover:bg-slate-100 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <span>{t("showLessMembers")}</span>
                <span className="material-symbols-outlined text-[16px]">expand_less</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Prominent Action Button: Cotiser maintenant -> */}
      {hasUnpaid ? (
        <button
          type="button"
          onClick={handleMainCotiserAction}
          disabled={isDraftSession || !!lockedReason}
          className="w-full mt-4 py-3.5 px-6 rounded-2xl bg-[#064e3b] hover:bg-[#053d2e] text-white font-bold text-base flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/20 active:scale-[0.99] transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <span>{t("contributeNow").replace("→", "").trim()}</span>
          <span className="text-amber-400 font-black text-lg">→</span>
        </button>
      ) : (
        <div className="w-full mt-4 py-3 px-4 rounded-2xl bg-emerald-50 border border-emerald-200/80 text-emerald-800 text-center text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 shadow-2xs">
          <span className="material-symbols-outlined text-[18px] text-emerald-600">check_circle</span>
          <span>{t("allContributionsSettled")}</span>
        </div>
      )}

      {/* Notice si les cotisations sont bloquées (ex: pas d'ordre de bouffe) */}
      {lockedReason && hasUnpaid && (
        <div className="w-full mt-3 p-3.5 rounded-2xl bg-amber-50 border border-amber-200/80 text-amber-900 flex items-center gap-2.5 text-xs sm:text-sm font-medium shadow-2xs">
          <span className="material-symbols-outlined text-amber-600 text-[20px] flex-shrink-0">
            lock
          </span>
          <span>{lockedReason}</span>
        </div>
      )}

      {/* Offline notification notice */}
      {savedOffline && (
        <p className="text-center text-xs text-secondary-fixed-dim mt-2 font-medium">
          {t("contributionSavedOfflineTitle")}
        </p>
      )}

      {/* Single slot payment confirm modal */}
      {activeSlotIdForPay && (
        <PaymentConfirmDialog
          lang={lang}
          membershipSlotId={activeSlotIdForPay}
          payEndpoint="/api/payments/fapshi/initiate"
          description={paymentDescription}
          defaultPhone={defaultPhone}
          onSettled={() => {
            setActiveSlotIdForPay(null);
            router.refresh();
          }}
          onClose={() => setActiveSlotIdForPay(null)}
        />
      )}

      {/* Bulk slot payment dialog */}
      {showBulkDialog && (
        <BulkPaymentDialog
          lang={lang}
          membershipSlotIds={myUnpaidSlotIds}
          defaultPhone={defaultPhone}
          onSettled={() => {
            setShowBulkDialog(false);
            router.refresh();
          }}
          onClose={() => setShowBulkDialog(false)}
        />
      )}
    </section>
  );
}
