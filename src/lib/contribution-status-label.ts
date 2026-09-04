import type { translate } from "@/lib/i18n/translations";

/** Maps the raw Prisma ContributionStatus enum to an existing translated label — reuses the same short generic keys the member-facing session page already uses ("paid"/"late"/"pending"), never a raw enum in admin/member UI. */
export const CONTRIBUTION_STATUS_KEY: Record<string, Parameters<typeof translate>[1]> = {
  PAID: "paid",
  LATE: "late",
  PENDING: "pending",
  FAILED: "notifStatusFailed",
};
