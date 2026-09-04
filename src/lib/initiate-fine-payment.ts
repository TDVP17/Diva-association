import { prisma } from "@/lib/prisma";
import { initiateDirectPayment, normalizeCameroonPhone, FapshiError } from "@/lib/fapshi";
import { computeProviderFee } from "@/lib/payment-fees";
import { detectMobileMoneyProvider, fapshiMediumFor } from "@/lib/mobile-money-provider";
import type { PaymentProvider } from "@/generated/prisma/enums";

export type InitiateFinePaymentResult =
  | { ok: true; transId: string }
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

// Same in-flight window used for slot payments — see initiate-slot-payment.ts.
const IN_FLIGHT_WINDOW_MS = 10 * 60 * 1000;

async function loadOwnedPayableFine(fineId: string, userId: string) {
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
  const fine = await loadOwnedPayableFine(fineId, userId);
  if (!fine) {
    return { ok: false, status: 404, error: "Fine not found" };
  }
  if (fine.status === "PAID" || fine.status === "DEDUCTED") {
    return { ok: false, status: 409, error: "This fine has already been settled" };
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

/** Requires the payer's own Mobile Money/Orange Money phone — see initiateSlotPayment(). */
export async function initiateFinePayment(
  fineId: string,
  phone: string,
  userId: string,
): Promise<InitiateFinePaymentResult> {
  const normalizedPhone = normalizeCameroonPhone(phone);
  if (!normalizedPhone) {
    return { ok: false, status: 400, error: "Please enter a valid Mobile Money / Orange Money number" };
  }

  const fine = await loadOwnedPayableFine(fineId, userId);
  if (!fine) {
    return { ok: false, status: 404, error: "Fine not found" };
  }

  const provider: PaymentProvider = "FAPSHI";
  const providerFee = computeProviderFee(provider, Number(fine.amount));

  let claimed: { id: string };
  try {
    claimed = await prisma.$transaction(async (tx) => {
      const [current] = await tx.$queryRaw<
        { id: string; status: string; fapshiTxRef: string | null; updatedAt: Date }[]
      >`SELECT id, status, "fapshiTxRef", "updatedAt" FROM fines WHERE id = ${fineId} FOR UPDATE`;

      if (!current || current.status === "PAID" || current.status === "DEDUCTED") {
        throw new AlreadySettledError();
      }
      if (
        current.status === "PENDING" &&
        current.fapshiTxRef &&
        Date.now() - new Date(current.updatedAt).getTime() < IN_FLIGHT_WINDOW_MS
      ) {
        throw new PaymentInProgressError();
      }

      return tx.fine.update({
        where: { id: fineId },
        data: { payerPhone: normalizedPhone, failureReason: null },
      });
    });
  } catch (err) {
    if (err instanceof AlreadySettledError) {
      return { ok: false, status: 409, error: "This fine has already been settled" };
    }
    if (err instanceof PaymentInProgressError) {
      return {
        ok: false,
        status: 409,
        error: "A payment is already in progress for this fine — please wait a moment before trying again",
      };
    }
    throw err;
  }

  try {
    const detectedProvider = detectMobileMoneyProvider(normalizedPhone);
    const result = await initiateDirectPayment({
      amount: providerFee.totalCharged,
      phone: normalizedPhone,
      userId,
      externalId: fine.id,
      message: `DIVA late-payment fine — ${fine.membershipSlot.beneficiaryName}`,
      medium: detectedProvider ? fapshiMediumFor(detectedProvider) : undefined,
    });

    await prisma.$transaction([
      prisma.fine.update({ where: { id: claimed.id }, data: { fapshiTxRef: result.transId } }),
      prisma.paymentAttempt.create({
        data: {
          transId: result.transId,
          fineId: claimed.id,
          payerPhone: normalizedPhone,
          amount: providerFee.totalCharged,
        },
      }),
    ]);

    return { ok: true, transId: result.transId };
  } catch (error) {
    await prisma.fine.update({
      where: { id: claimed.id },
      data: {
        failureReason: error instanceof FapshiError ? error.message : "Payment initiation failed",
      },
    });
    if (error instanceof FapshiError) {
      return { ok: false, status: 502, error: error.message };
    }
    return { ok: false, status: 500, error: "Payment initiation failed" };
  }
}

class AlreadySettledError extends Error {}
class PaymentInProgressError extends Error {}
