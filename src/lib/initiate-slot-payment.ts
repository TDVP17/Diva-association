import { prisma } from "@/lib/prisma";
import { getContributionTotal, getNextDueDate } from "@/lib/tontine-engine";
import { initiatePayment, FapshiError } from "@/lib/fapshi";
import { assertPriorCyclePaidOut } from "@/lib/round-robin-lock";

export type InitiateSlotPaymentResult =
  | { ok: true; paymentUrl: string; transId: string }
  | { ok: false; status: number; error: string };

/**
 * Shared logic behind both the authenticated self-pay route and the public
 * (no-login) third-party pay route — the only difference between the two
 * callers is whether an ownership check happens before this runs. Each slot
 * has its own fully independent Contribution history, so a slot is what's
 * paid for here, not a membership/user.
 */
export async function initiateSlotPayment(
  membershipSlotId: string,
  origin: string,
): Promise<InitiateSlotPaymentResult> {
  const slot = await prisma.membershipSlot.findUnique({
    where: { id: membershipSlotId },
    include: { membership: { include: { tontineSession: true } } },
  });
  if (!slot || slot.membership.status !== "APPROVED" || slot.membership.tontineSession.status !== "ACTIVE") {
    return { ok: false, status: 404, error: "This slot isn't currently accepting contributions" };
  }

  const { tontineSession } = slot.membership;
  const now = new Date();
  const dueDate = getNextDueDate(tontineSession.type, now);

  const roundLock = await assertPriorCyclePaidOut(
    tontineSession.id,
    tontineSession.type,
    dueDate,
    tontineSession.startDate,
  );
  if (!roundLock.ok) {
    return { ok: false, status: roundLock.status, error: roundLock.error };
  }

  const { amount, fee } = getContributionTotal({
    amount: Number(tontineSession.amount),
    fee: Number(tontineSession.fee),
  });

  const existing = await prisma.contribution.findUnique({
    where: { membershipSlotId_dueDate: { membershipSlotId, dueDate } },
  });
  if (existing?.status === "PAID") {
    return { ok: false, status: 409, error: "This slot is already paid for this cycle" };
  }

  const outstandingFine = await prisma.fine.findUnique({
    where: { membershipSlotId_dueDate: { membershipSlotId, dueDate } },
  });
  const fineAmount =
    outstandingFine && outstandingFine.status === "UNPAID" ? Number(outstandingFine.amount) : 0;
  const totalAmount = amount + fee + fineAmount;

  const contribution = await prisma.contribution.upsert({
    where: { membershipSlotId_dueDate: { membershipSlotId, dueDate } },
    create: {
      membershipSlotId,
      dueDate,
      amountPaid: amount,
      feePaid: fee,
      finePaid: fineAmount,
      status: "PENDING",
    },
    update: {
      amountPaid: amount,
      feePaid: fee,
      finePaid: fineAmount,
    },
  });

  try {
    const result = await initiatePayment({
      amount: totalAmount,
      userId: slot.membership.userId,
      externalId: contribution.id,
      redirectUrl: `${origin}/sessions/${tontineSession.id}?payment=${contribution.id}`,
      message: `DIVA tontine contribution — ${slot.beneficiaryName} (${tontineSession.type})`,
    });

    await prisma.contribution.update({
      where: { id: contribution.id },
      data: { fapshiTxRef: result.transId },
    });

    return { ok: true, paymentUrl: result.link, transId: result.transId };
  } catch (error) {
    if (error instanceof FapshiError) {
      return { ok: false, status: 502, error: error.message };
    }
    return { ok: false, status: 500, error: "Payment initiation failed" };
  }
}
