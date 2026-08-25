// Paths that require a signed-in session. Everything else (landing page,
// /login, static assets, webhooks, cron routes) is reachable without auth.
export const PROTECTED_PATH_PREFIXES = [
  "/dashboard",
  "/sessions",
  "/chat",
  "/admin",
  "/profile",
] as const;

export const ADMIN_PATH_PREFIX = "/admin";

export const CUTOFF_HOUR = 18;
export const CUTOFF_MINUTE = 31;
export const CAMEROON_TIME_ZONE = "Africa/Douala";
