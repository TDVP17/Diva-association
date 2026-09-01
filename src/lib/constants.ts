// Paths that require a signed-in session. Everything else (landing page,
// /login, static assets, webhooks, cron routes) is reachable without auth.
export const PROTECTED_PATH_PREFIXES = [
  "/dashboard",
  "/sessions",
  "/chat",
  "/admin",
  "/profile",
  "/fines",
  "/notifications",
  "/history",
  "/help",
  "/contribute-for-relative",
  "/reglement-general",
] as const;

export const ADMIN_PATH_PREFIX = "/admin";

/** PRESIDENT has full admin access plus the global financial view — treated as an admin everywhere except requirePresident()-gated routes. */
export function isAdminRole(role: string | null | undefined): boolean {
  return role === "ADMIN" || role === "PRESIDENT";
}

export const CUTOFF_HOUR = 18;
export const CUTOFF_MINUTE = 31;
export const CAMEROON_TIME_ZONE = "Africa/Douala";
