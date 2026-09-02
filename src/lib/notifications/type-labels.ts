import type { translate } from "@/lib/i18n/translations";

/**
 * Every NotificationEventType mapped to its translation key. Shared between
 * the member-facing feed (src/app/(app)/notifications) and the admin
 * notification center (src/app/admin/notifications) so a raw enum value
 * (e.g. "MEMBER_APPROVED") can never leak into either UI — both must go
 * through this single map instead of maintaining their own copies.
 */
export const NOTIFICATION_TYPE_KEY: Record<string, Parameters<typeof translate>[1]> = {
  CONTRIBUTION_REMINDER: "notifTypeContributionReminder",
  FINE_REMINDER: "notifTypeFineReminder",
  FOOD_TURN: "notifTypeFoodTurn",
  PAYMENT_SUCCESS: "notifTypePaymentSuccess",
  PAYMENT_FAILED: "notifTypePaymentFailed",
  ADMIN_BROADCAST: "notifTypeAdminBroadcast",
  MEMBER_APPROVED: "notifTypeMemberApproved",
  MEMBER_REJECTED: "notifTypeMemberRejected",
  SWAP_REQUEST_CREATED: "notifTypeSwapRequestCreated",
  SWAP_REQUEST_PENDING_ADMIN: "notifTypeSwapRequestPendingAdmin",
  SWAP_REQUEST_APPROVED: "notifTypeSwapRequestApproved",
  SWAP_REQUEST_REJECTED: "notifTypeSwapRequestRejected",
  NEW_MEMBERSHIP_REQUEST: "notifTypeNewMembershipRequest",
  DRAW_LAUNCHED: "notifTypeDrawLaunched",
  PAYMENT_REFUND_ESCALATED: "notifTypePaymentRefundEscalated",
  PAYOUT_TURN: "notifTypePayoutTurn",
};

/** Notification/reminder delivery status, for the admin notification center's log view. */
export const NOTIFICATION_STATUS_KEY: Record<string, Parameters<typeof translate>[1]> = {
  SENT: "notifStatusSent",
  SCHEDULED: "notifStatusScheduled",
  PROCESSING: "notifStatusProcessing",
  FAILED: "notifStatusFailed",
  PENDING: "notifStatusPending",
};
