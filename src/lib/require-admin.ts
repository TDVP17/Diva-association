import { auth } from "@/auth";

/** PRESIDENT gets everything ADMIN gets, plus the global financial view gated by requirePresident() below. */
export async function requireAdmin() {
  const session = await auth();
  if (!session?.user || (session.user.role !== "ADMIN" && session.user.role !== "PRESIDENT")) {
    return null;
  }
  return session;
}

/** Gates the global, cross-contribution financial view (total fees, total fines) — ADMIN alone is not enough. */
export async function requirePresident() {
  const session = await auth();
  if (!session?.user || session.user.role !== "PRESIDENT") {
    return null;
  }
  return session;
}
