import { prisma } from "@/lib/prisma";
import { getContributionTotal, getNextDueDate } from "@/lib/tontine-engine";
import { initiatePayment, FapshiError } from "@/lib/fapshi";
import { assertPriorCyclePaidOut } from "@/lib/round-robin-lock";
import { computeProviderFee } from "@/lib/payment-fees";
import type { PaymentProvider } from "@/generated/prisma/enums";

export type InitiateSlotPaymentResult =
  | { ok: true; paymentUrl: string; transId: string }
  | { ok: false; status: number; error: string };

export interface SlotPaymentQuote {
  amount: number;
  fee: number;
  fineAmount: number;
  /** amount + fee + fineAmount, before the payment-gateway fee. */
  baseTotal: number;
  provider: PaymentProvider;
  /** Total gateway fee only — never the internal gateway/president split. */
  providerFeeAmount: number;
  /** baseTotal + providerFeeAmount — what actually gets deducted. */
  totalCharged: number;
}

export type SlotPaymentQuoteResult =
  | { ok: true; quote: SlotPaymentQuote }
  | { ok: false; status: number; error: string };

/**
 * Read-only preview of what a slot payment will cost, including the
 * payment-gateway fee — powers the pre-redirect "Amount / Payment fee /
 * Total" confirmation screen. Deliberately skips assertPriorCyclePaidOut
 * (no side effects to avoid, and the real initiateSlotPayment call still
 * enforces it authoritatively) so this stays a cheap, non-mutating preview.
 */
export async function getSlotPaymentQuote(
  membershipSlotId: string,
  provider: PaymentProvider = "FAPSHI",
): Promise<SlotPaymentQuoteResult> {
  const slot = await prisma.membershipSlot.findUnique({
    where: { id: membershipSlotId },
    include: { membership: { include: { tontineSession: true } } },
  });
  if (!slot || slot.membership.status !== "APPROVED" || slot.membership.tontineSession.status !== "ACTIVE") {
    return { ok: false, status: 404, error: "This slot isn't currently accepting contributions" };
  }
  if (slot.membership.tontineSession.isPaused) {
    return { ok: false, status: 409, error: "This cotisation is temporarily paused — payments will resume shortly" };
  }

  const { tontineSession } = slot.membership;
  const dueDate = getNextDueDate(tontineSession.type, new Date());

  const existing = await prisma.contribution.findUnique({
    where: { membershipSlotId_dueDate: { membershipSlotId, dueDate } },
  });
  if (existing?.status === "PAID") {
    return { ok: false, status: 409, error: "This slot is already paid for this cycle" };
  }

  const { amount, fee } = getContributionTotal({
    amount: Number(tontineSession.amount),
    fee: Number(tontineSession.fee),
  });

  const outstandingFine = await prisma.fine.findUnique({
    where: { membershipSlotId_dueDate: { membershipSlotId, dueDate } },
  });
  const fineAmount =
    outstandingFine && outstandingFine.status === "UNPAID" ? Number(outstandingFine.amount) : 0;

  const baseTotal = amount + fee + fineAmount;
  const providerFee = computeProviderFee(provider, baseTotal);

  return {
    ok: true,
    quote: {
      amount,
      fee,
      fineAmount,
      baseTotal,
      provider,
      providerFeeAmount: providerFee.providerFeeAmount,
      totalCharged: providerFee.totalCharged,
    },
  };
}

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
  options?: { paidByUserId?: string },
): Promise<InitiateSlotPaymentResult> {
  const slot = await prisma.membershipSlot.findUnique({
    where: { id: membershipSlotId },
    include: { membership: { include: { tontineSession: true } } },
  });
  if (!slot || slot.membership.status !== "APPROVED" || slot.membership.tontineSession.status !== "ACTIVE") {
    return { ok: false, status: 404, error: "This slot isn't currently accepting contributions" };
  }
  if (slot.membership.tontineSession.isPaused) {
    return { ok: false, status: 409, error: "This cotisation is temporarily paused — payments will resume shortly" };
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
  const baseTotal = amount + fee + fineAmount;

  const provider: PaymentProvider = "FAPSHI";
  const providerFee = computeProviderFee(provider, baseTotal);

  const contribution = await prisma.contribution.upsert({
    where: { membershipSlotId_dueDate: { membershipSlotId, dueDate } },
    create: {
      membershipSlotId,
      dueDate,
      amountPaid: amount,
      feePaid: fee,
      finePaid: fineAmount,
      status: "PENDING",
      paidByUserId: options?.paidByUserId,
      paymentProvider: provider,
      providerFeeAmount: providerFee.providerFeeAmount,
      providerShareAmount: providerFee.providerShareAmount,
      presidentFeeShareAmount: providerFee.presidentFeeShareAmount,
    },
    update: {
      amountPaid: amount,
      feePaid: fee,
      finePaid: fineAmount,
      paidByUserId: options?.paidByUserId,
      paymentProvider: provider,
      providerFeeAmount: providerFee.providerFeeAmount,
      providerShareAmount: providerFee.providerShareAmount,
      presidentFeeShareAmount: providerFee.presidentFeeShareAmount,
    },
  });

  try {
    const result = await initiatePayment({
      amount: providerFee.totalCharged,
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
