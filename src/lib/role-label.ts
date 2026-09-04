import type { translate } from "@/lib/i18n/translations";

/** Maps the raw Prisma Role enum to a translated label — never shown raw in profile/settings/admin-users UI. */
export const ROLE_KEY: Record<string, Parameters<typeof translate>[1]> = {
  MEMBER: "roleMember",
  ADMIN: "roleAdmin",
  PRESIDENT: "rolePresident",
};
