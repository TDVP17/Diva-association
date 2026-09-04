import type { translate } from "@/lib/i18n/translations";

/**
 * Compact admin-list label for a PayoutClaim's own status — deliberately
 * separate from payout-order-modal.tsx's payoutStatus* keys, which narrate
 * a MEMBER's own upcoming turn (and payoutStatusConfirmed there requires a
 * {date} var this compact badge doesn't have). Same underlying
 * PayoutStatus enum, different display context.
 */
export const PAYOUT_CLAIM_STATUS_KEY: Record<string, Parameters<typeof translate>[1]> = {
  DETAILS_SUBMITTED: "payoutClaimStatusSubmitted",
  RELEASED: "payoutClaimStatusReleased",
  CONFIRMED: "payoutClaimStatusConfirmed",
};
