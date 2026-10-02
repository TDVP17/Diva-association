import { prisma } from "@/lib/prisma";
import type { TontineSession, MembershipSlot, Membership, User } from "@/generated/prisma/client";

export interface DeductedContributionItem {
  slotId: string;
  beneficiaryName: string;
  amount: number;
  fee: number;
}

export interface PayoutPreview {
  pot: number;
  deductedFines: number;
  deductedContributions: number;
  deducted: number;
  netPayout: number;
  dueDate: Date;
  toDeductFineIds: string[];
  toDeductContributions: DeductedContributionItem[];
}

type SlotWithMembership = MembershipSlot & { membership: Membership & { user: User } };

/**
 * Pure computation, no side effects — shared by the preview (GET) and
 * release (POST) routes so they never drift. `dueDate` is always the
 * payout claim's own cycle (set when the beneficiary submitted their
 * details).
 *
 * Si le membre bénéficiaire n'a pas encore cotisé pour ses parts ("son nom ou ses noms")
 * pour ce cycle, sa cotisation (montant + frais) est déduite de la cagnotte reçue
 * et sera automatiquement marquée comme PAYÉE lors de la libération du versement.
 */
export async function computePayoutPreview(
  tontineSession: TontineSession,
  slot: SlotWithMembership,
  dueDate: Date,
): Promise<PayoutPreview> {
  const [potAgg, unpaidFines, memberSlots] = await Promise.all([
    prisma.contribution.aggregate({
      where: {
        membershipSlot: { membership: { tontineSessionId: tontineSession.id } },
        dueDate,
        status: "PAID",
      },
      _sum: { amountPaid: true, feePaid: true },
    }),
    prisma.fine.findMany({
      where: { membershipSlotId: slot.id, status: "UNPAID" },
      orderBy: { createdAt: "asc" },
    }),
    prisma.membershipSlot.findMany({
      where: { membershipId: slot.membershipId },
      include: {
        contributions: {
          where: { dueDate, status: "PAID" },
        },
      },
    }),
  ]);

  // Identifier les parts du bénéficiaire non encore payées pour ce cycle
  const toDeductContributions: DeductedContributionItem[] = [];
  let unpaidContribAmount = 0;
  let unpaidContribFee = 0;

  for (const mSlot of memberSlots) {
    if (mSlot.contributions.length === 0) {
      const amt = Number(tontineSession.amount);
      const fee = Number(tontineSession.fee);
      toDeductContributions.push({
        slotId: mSlot.id,
        beneficiaryName: mSlot.beneficiaryName,
        amount: amt,
        fee,
      });
      unpaidContribAmount += amt;
      unpaidContribFee += fee;
    }
  }

  const paidAmount = Number(potAgg._sum.amountPaid ?? 0);
  const paidFees = Number(potAgg._sum.feePaid ?? 0);

  // Cagnotte brute : cotisations déjà payées + cotisations du bénéficiaire intégrées
  const grossPotAmount = paidAmount + unpaidContribAmount;
  const grossFees = paidFees + unpaidContribFee;
  // Le montant à bouffer comprend la somme des cotisations + 25% des frais (75% restent à l'admin)
  const pot = Math.round(grossPotAmount + (grossFees * 0.25));

  // Déductions : cotisations propres non payées à déduire
  const deductedContributions = unpaidContribAmount + unpaidContribFee;

  // Déductions : amendes impayées
  let deductedFines = 0;
  const toDeductFineIds: string[] = [];
  for (const fine of unpaidFines) {
    const amount = Number(fine.amount);
    if (deductedContributions + deductedFines + amount > pot) break;
    deductedFines += amount;
    toDeductFineIds.push(fine.id);
  }

  const deducted = deductedContributions + deductedFines;
  const netPayout = Math.max(0, pot - deducted);

  return {
    pot,
    deductedFines,
    deductedContributions,
    deducted,
    netPayout,
    dueDate,
    toDeductFineIds,
    toDeductContributions,
  };
}
