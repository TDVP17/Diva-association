import { prisma } from "@/lib/prisma";
import { getMostRecentDueDate } from "@/lib/tontine-engine";
import type { TontineSession, MembershipSlot, Membership, User } from "@/generated/prisma/client";

export interface PayoutPreview {
  pot: number;
  deducted: number;
  netPayout: number;
  dueDate: Date;
  toDeductFineIds: string[];
}

type SlotWithMembership = MembershipSlot & { membership: Membership & { user: User } };

/** Pure computation, no side effects — shared by the preview (GET) and release (POST) routes so they never drift. */
export async function computePayoutPreview(
  tontineSession: TontineSession,
  slot: SlotWithMembership,
): Promise<PayoutPreview> {
  const dueDate = getMostRecentDueDate(tontineSession.type, new Date());

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
