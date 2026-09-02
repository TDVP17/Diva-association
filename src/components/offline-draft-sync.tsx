"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { translate, type Lang } from "@/lib/i18n/translations";
import { PaymentConfirmDialog } from "@/components/payment-confirm-dialog";
import {
  listDraftContributions,
  deleteDraftContribution,
  listQueuedChatMessages,
  requestBackgroundSync,
  type DraftContribution,
} from "@/lib/offline/db";

/**
 * App-wide offline awareness: a persistent "you're offline" indicator, and
 * — once connectivity returns — a prompt to review any contribution
 * drafts composed while offline (see pay-button.tsx) plus a Background
 * Sync kick for any chat messages queued while offline (safe to auto-send,
 * unlike a payment). Drafts are never auto-submitted: reviewing one opens
 * the exact same PaymentConfirmDialog used everywhere else, which always
 * fetches a fresh quote and still requires the member's own tap to pay.
 */
export function OfflineDraftSync({ lang }: { lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const router = useRouter();
  const [isOnline, setIsOnline] = useState(true);
  const [drafts, setDrafts] = useState<DraftContribution[]>([]);
  const [reviewing, setReviewing] = useState<DraftContribution | null>(null);

  const refreshDrafts = useCallback(() => {
    listDraftContributions()
      .then(setDrafts)
      .catch(() => setDrafts([]));
  }, []);

  useEffect(() => {
    let removeListeners: (() => void) | undefined;

    // Deferred a tick so the setIsOnline/refreshDrafts calls below never run
    // synchronously in the effect body itself (react-hooks/set-state-in-effect).
    const setupHandle = setTimeout(() => {
      setIsOnline(navigator.onLine);
      refreshDrafts();

      function handleOnline() {
        setIsOnline(true);
        refreshDrafts();
        listQueuedChatMessages()
          .then((queued) => {
            if (queued.length > 0) requestBackgroundSync("sync-chat-messages");
          })
          .catch(() => {});
      }
      function handleOffline() {
        setIsOnline(false);
      }
      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);
      removeListeners = () => {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
      };
    }, 0);

    return () => {
      clearTimeout(setupHandle);
      removeListeners?.();
    };
  }, [refreshDrafts]);

  function closeReview() {
    setReviewing(null);
  }

  async function handleSettled() {
    if (reviewing) await deleteDraftContribution(reviewing.id);
    setReviewing(null);
    refreshDrafts();
    router.refresh();
  }

  return (
    <>
      {!isOnline && (
        <div className="fixed top-16 inset-x-0 z-40 bg-secondary text-on-secondary text-center py-1.5 font-label-sm text-label-sm flex items-center justify-center gap-1.5">
          <span className="material-symbols-outlined text-[16px]">cloud_off</span>
          {t("offlineBannerText")}
        </div>
      )}

      {isOnline && drafts.length > 0 && !reviewing && (
        <div className="fixed bottom-20 md:bottom-4 inset-x-0 z-40 flex justify-center px-container-padding pointer-events-none">
          <div className="w-full max-w-sm bg-surface rounded-xl shadow-xl border border-surface-variant p-4 flex items-center justify-between gap-3 pointer-events-auto">
            <div className="min-w-0">
              <p className="font-label-md text-label-md text-on-surface">
                {t("draftContributionsReady", { count: String(drafts.length) })}
              </p>
              <p className="font-label-sm text-label-sm text-on-surface-variant truncate">{drafts[0].beneficiaryName}</p>
            </div>
            <button
              onClick={() => setReviewing(drafts[0])}
              className="flex-shrink-0 px-3 py-1.5 rounded-lg bg-primary text-on-primary font-label-sm text-label-sm hover:opacity-90 transition-all"
            >
              {t("reviewDraftsAction")}
            </button>
          </div>
        </div>
      )}

      {reviewing && (
        <PaymentConfirmDialog
          lang={lang}
          membershipSlotId={reviewing.membershipSlotId}
          payEndpoint="/api/payments/fapshi/initiate"
          description={reviewing.description}
          defaultPhone={reviewing.phone}
          onSettled={handleSettled}
          onClose={closeReview}
        />
      )}
    </>
  );
}
