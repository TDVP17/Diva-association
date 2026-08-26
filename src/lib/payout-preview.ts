import { prisma } from "@/lib/prisma";
import type { TontineSession, MembershipSlot, Membership, User } from "@/generated/prisma/client";

export interface PayoutPreview {
  pot: number;
  deducted: number;
  netPayout: number;
  dueDate: Date;
  toDeductFineIds: string[];
}

type SlotWithMembership = MembershipSlot & { membership: Membership & { user: User } };

/**
 * Pure computation, no side effects — shared by the preview (GET) and
 * release (POST) routes so they never drift. `dueDate` is always the
 * payout claim's own cycle (set when the beneficiary submitted their
 * details) — never recomputed as "whatever cycle is most recent right
 * now," since time may have passed between submission and admin review.
 */
export async function computePayoutPreview(
  tontineSession: TontineSession,
  slot: SlotWithMembership,
  dueDate: Date,
): Promise<PayoutPreview> {
  const [potAgg, unpaidFines] = await Promise.all([
    prisma.contribution.aggregate({
      where: { membershipSlot: { membership: { tontineSessionId: tontineSession.id } }, dueDate, status: "PAID" },
      _sum: { amountPaid: true },
    }),
    prisma.fine.findMany({
      where: { membershipSlotId: slot.id, status: "UNPAID" },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const pot = Number(potAgg._sum.amountPaid ?? 0);

  let deducted = 0;
  const toDeductFineIds: string[] = [];
  for (const fine of unpaidFines) {
    const amount = Number(fine.amount);
    if (deducted + amount > pot) break;
    deducted += amount;
    toDeductFineIds.push(fine.id);
  }

  return { pot, deducted, netPayout: pot - deducted, dueDate, toDeductFineIds };
}
