import { prisma } from "@/lib/prisma";
import { initiatePayment, FapshiError } from "@/lib/fapshi";
import { computeProviderFee } from "@/lib/payment-fees";
import type { PaymentProvider } from "@/generated/prisma/enums";

export type InitiateFinePaymentResult =
  | { ok: true; paymentUrl: string; transId: string }
  | { ok: false; status: number; error: string };

export interface FinePaymentQuote {
  baseTotal: number;
  provider: PaymentProvider;
  providerFeeAmount: number;
  totalCharged: number;
}

export type FinePaymentQuoteResult =
  | { ok: true; quote: FinePaymentQuote }
  | { ok: false; status: number; error: string };

async function loadOwnedUnpaidFine(fineId: string, userId: string) {
  const fine = await prisma.fine.findUnique({
    where: { id: fineId },
    include: { membershipSlot: { include: { membership: { include: { tontineSession: true } } } } },
  });
  if (!fine || fine.membershipSlot.membership.userId !== userId) return null;
  return fine;
}

/**
 * Unlike a slot's contribution, a Fine can be paid completely on its own —
 * it isn't tied to the CURRENT cycle's Contribution, so this is the only
 * path that can ever settle a fine from a past cycle (initiateSlotPayment
 * only ever looks at the fine matching today's dueDate).
 */
export async function getFinePaymentQuote(fineId: string, userId: string): Promise<FinePaymentQuoteResult> {
  const fine = await loadOwnedUnpaidFine(fineId, userId);
  if (!fine) {
    return { ok: false, status: 404, error: "Fine not found" };
  }
  if (fine.status !== "UNPAID") {
    return { ok: false, status: 409, error: "This fine has already been paid" };
  }

  const provider: PaymentProvider = "FAPSHI";
  const baseTotal = Number(fine.amount);
  const providerFee = computeProviderFee(provider, baseTotal);

  return {
    ok: true,
    quote: {
      baseTotal,
      provider,
      providerFeeAmount: providerFee.providerFeeAmount,
      totalCharged: providerFee.totalCharged,
    },
  };
}

export async function initiateFinePayment(
  fineId: string,
  userId: string,
  origin: string,
): Promise<InitiateFinePaymentResult> {
  const fine = await loadOwnedUnpaidFine(fineId, userId);
  if (!fine) {
    return { ok: false, status: 404, error: "Fine not found" };
  }
  if (fine.status !== "UNPAID") {
    return { ok: false, status: 409, error: "This fine has already been paid" };
  }

  const provider: PaymentProvider = "FAPSHI";
  const providerFee = computeProviderFee(provider, Number(fine.amount));
  const tontineSessionId = fine.membershipSlot.membership.tontineSessionId;

  try {
    const result = await initiatePayment({
      amount: providerFee.totalCharged,
      userId,
      externalId: fine.id,
      redirectUrl: `${origin}/sessions/${tontineSessionId}?finePayment=${fine.id}`,
      message: `DIVA late-payment fine — ${fine.membershipSlot.beneficiaryName}`,
    });

    await prisma.fine.update({ where: { id: fine.id }, data: { fapshiTxRef: result.transId } });

    return { ok: true, paymentUrl: result.link, transId: result.transId };
  } catch (error) {
    if (error instanceof FapshiError) {
      return { ok: false, status: 502, error: error.message };
    }
    return { ok: false, status: 500, error: "Payment initiation failed" };
  }
}
