export type JoinabilityResult = { ok: true } | { ok: false; status: number; error: string };

/**
 * Shared "can a new join request even be started" gate — used by both the
 * KYC-session-creation route and the browse-listing query, so browsing,
 * starting KYC, and actually joining never disagree about what counts as
 * still open. Both locks are computed live rather than via a persisted
 * status flip (always accurate, no cron): startDate always locks
 * regardless of how full the session is, and reaching maxSlots locks it
 * independently even before the start date arrives.
 */
export function assertJoinable(
  session: { status: string; startDate: Date; maxSlots: number | null },
  registeredSlots: number,
): JoinabilityResult {
  if (session.status === "CLOSED") {
    return { ok: false, status: 409, error: "This session is closed and no longer accepting new members" };
  }
  if (new Date() >= session.startDate) {
    return {
      ok: false,
      status: 409,
      error: "This cotisation has already started and is no longer accepting new members",
    };
  }
  if (session.maxSlots !== null && registeredSlots >= session.maxSlots) {
    return { ok: false, status: 409, error: "This cotisation has reached its maximum capacity" };
  }
  return { ok: true };
}

/** Sum of Membership.slotCount across a session's APPROVED memberships. */
export function sumRegisteredSlots(memberships: Array<{ status: string; slotCount: unknown }>): number {
  return memberships
    .filter((m) => m.status === "APPROVED")
    .reduce((sum, m) => sum + (m.slotCount ? Number(m.slotCount) : 0), 0);
}
