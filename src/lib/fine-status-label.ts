import type { translate } from "@/lib/i18n/translations";

/** Maps the raw Prisma FineStatus enum to an existing translated label — reuses "paidStatus"/"unpaidStatus" already used elsewhere in the admin contribution detail view for the same concept. */
export const FINE_STATUS_KEY: Record<string, Parameters<typeof translate>[1]> = {
  UNPAID: "unpaidStatus",
  PAID: "paidStatus",
  DEDUCTED: "deductedStatus",
  FAILED: "notifStatusFailed",
};
