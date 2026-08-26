import { prisma } from "@/lib/prisma";
import { getPreviousDueDate } from "@/lib/tontine-engine";
import type { TontineType } from "@/generated/prisma/enums";

export type RoundLockResult = { ok: true } | { ok: false; status: number; error: string };

/**
 * "Whose turn is it" — the lowest-officialPosition slot in the session with
 * zero Payout rows ever. Shared by the round-robin lock below, the
 * beneficiary payout-details submission flow, and the session detail page
 * (to show the "it's your turn" prompt) — one definition, reused everywhere.
 */
export async function getDesignatedSlot(tontineSessionId: string) {
  return prisma.membershipSlot.findFirst({
    where: {
      membership: { tontineSessionId },
      officialPosition: { not: null },
      payouts: { none: {} },
    },
    orderBy: { officialPosition: "asc" },
  });
}

/**
 * Blocks paying INTO a new cycle before the previous cycle's designated
 * beneficiary has actually been paid out — i.e. no paying two rounds ahead.
 * On-time payment of the currently-open cycle is never blocked by this
 * check; existing due-date/fine logic is untouched. Naturally skips the
 * session's first-ever cycle (no prior round exists yet) and undrawn
 * sessions (no officialPosition set). Submitting payout details alone
 * doesn't unblock the next cycle — only an actually-executed transfer
 * (`releasedAt` set) does.
 */
export async function assertPriorCyclePaidOut(
  tontineSessionId: string,
  type: TontineType,
  dueDate: Date,
  startDate: Date,
): Promise<RoundLockResult> {
  const previousDueDate = getPreviousDueDate(type, dueDate);
  if (previousDueDate < startDate) {
    return { ok: true }; // this is the session's first-ever cycle
  }

  const designatedSlot = await getDesignatedSlot(tontineSessionId);
  if (!designatedSlot) {
    return { ok: true }; // no published ranking yet, or everyone already paid out
  }

  const previousCyclePayout = await prisma.payout.findUnique({
    where: { tontineSessionId_dueDate: { tontineSessionId, dueDate: previousDueDate } },
  });
  if (previousCyclePayout?.releasedAt) {
    return { ok: true };
  }

  return {
    ok: false,
    status: 409,
    error: `Contributions for a new cycle can't be collected until ${designatedSlot.beneficiaryName}'s payout from the previous cycle has been released.`,
  };
}
