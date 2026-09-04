import { prisma } from "@/lib/prisma";
import { getContributionTotal, getNextDueDate } from "@/lib/tontine-engine";
import { initiateDirectPayment, normalizeCameroonPhone, FapshiError } from "@/lib/fapshi";
import { assertPriorCyclePaidOut } from "@/lib/round-robin-lock";
import { computeProviderFee } from "@/lib/payment-fees";
import { detectMobileMoneyProvider, fapshiMediumFor } from "@/lib/mobile-money-provider";
import type { PaymentProvider } from "@/generated/prisma/enums";

export type InitiateSlotPaymentResult =
  | { ok: true; transId: string }
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

// A PENDING row with a live fapshiTxRef younger than this is treated as "a
// payment is already in flight" and blocks a second concurrent attempt —
// see the race-condition guard in initiateSlotPayment(). Long enough to
// cover someone actually completing the USSD prompt, short enough that an
// abandoned attempt doesn't lock the slot out for good.
const IN_FLIGHT_WINDOW_MS = 10 * 60 * 1000;

function isPaymentInFlight(existing: { status: string; fapshiTxRef: string | null; updatedAt: Date } | null): boolean {
  if (!existing || existing.status !== "PENDING" || !existing.fapshiTxRef) return false;
  return Date.now() - existing.updatedAt.getTime() < IN_FLIGHT_WINDOW_MS;
}

/**
 * Read-only preview of what a slot payment will cost, including the
 * payment-gateway fee — powers the pre-confirmation "Amount / Payment fee /
 * Total" screen. Deliberately skips assertPriorCyclePaidOut (no side
 * effects to avoid, and the real initiateSlotPayment call still enforces it
 * authoritatively) so this stays a cheap, non-mutating preview.
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
  // Defense in depth: in practice the only route that ever flips a session
  // to ACTIVE (publish-ranking) does so in the same transaction that
  // assigns officialPosition to every slot, so this can't currently happen
  // through the app's own routes — but the payment gate shouldn't rely on
  // that being the only way ACTIVE ever gets set. A slot with no assigned
  // position was never through the draw, regardless of session status.
  if (slot.officialPosition === null) {
    return { ok: false, status: 409, error: "This name hasn't been assigned a draw position yet" };
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
 * Shared logic behind the authenticated self-pay, authenticated
 * relative-pay, and public (no-login) third-party pay routes — the only
 * difference between the callers is whether an ownership check happens
 * before this runs. Each slot has its own fully independent Contribution
 * history, so a slot is what's paid for here, not a membership/user.
 *
 * Requires the payer's own Mobile Money/Orange Money phone — Fapshi's
 * direct-pay API pushes the USSD prompt straight to it, no redirect.
 */
export async function initiateSlotPayment(
  membershipSlotId: string,
  phone: string,
  options?: { paidByUserId?: string },
): Promise<InitiateSlotPaymentResult> {
  const normalizedPhone = normalizeCameroonPhone(phone);
  if (!normalizedPhone) {
    return { ok: false, status: 400, error: "Please enter a valid Mobile Money / Orange Money number" };
  }

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
  // See the identical check in getSlotPaymentQuote above for why this is
  // enforced here independently of tontineSession.status.
  if (slot.officialPosition === null) {
    return { ok: false, status: 409, error: "This name hasn't been assigned a draw position yet" };
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

  const outstandingFine = await prisma.fine.findUnique({
    where: { membershipSlotId_dueDate: { membershipSlotId, dueDate } },
  });
  const fineAmount =
    outstandingFine && outstandingFine.status === "UNPAID" ? Number(outstandingFine.amount) : 0;
  const baseTotal = amount + fee + fineAmount;

  const provider: PaymentProvider = "FAPSHI";
  const providerFee = computeProviderFee(provider, baseTotal);

  // Row-locks the slot for the duration of this check-and-claim so two
  // concurrent payment attempts for the same slot+cycle (e.g. the member
  // and a relative tapping Pay at the same moment) can't both proceed —
  // the second transaction blocks here until the first commits, then sees
  // the freshly-claimed PENDING row and is rejected below. The slow Fapshi
  // HTTP call happens after this transaction commits, never while the lock
  // is held.
  let contribution: { id: string };
  try {
    contribution = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM membership_slots WHERE id = ${membershipSlotId} FOR UPDATE`;

      const existing = await tx.contribution.findUnique({
        where: { membershipSlotId_dueDate: { membershipSlotId, dueDate } },
      });
      if (existing?.status === "PAID") {
        throw new AlreadyPaidError();
      }
      if (isPaymentInFlight(existing)) {
        throw new PaymentInProgressError();
      }

      const data = {
        amountPaid: amount,
        feePaid: fee,
        finePaid: fineAmount,
        status: "PENDING" as const,
        payerPhone: normalizedPhone,
        failureReason: null,
        paidByUserId: options?.paidByUserId,
        paymentProvider: provider,
        providerFeeAmount: providerFee.providerFeeAmount,
        providerShareAmount: providerFee.providerShareAmount,
        presidentFeeShareAmount: providerFee.presidentFeeShareAmount,
      };

      return existing
        ? await tx.contribution.update({ where: { id: existing.id }, data })
        : await tx.contribution.create({ data: { membershipSlotId, dueDate, ...data } });
    });
  } catch (err) {
    if (err instanceof AlreadyPaidError) {
      return { ok: false, status: 409, error: "This slot is already paid for this cycle" };
    }
    if (err instanceof PaymentInProgressError) {
      return {
        ok: false,
        status: 409,
        error: "A payment is already in progress for this slot — please wait a moment before trying again",
      };
    }
    throw err;
  }

  try {
    // Best-effort — tells Fapshi explicitly which network to route the USSD
    // push through instead of leaving it to Fapshi's own auto-detection.
    // Always re-derived from the phone number itself (never trusted from
    // client input); an unrecognized prefix just falls back to undefined
    // (today's behavior) rather than blocking the payment.
    const detectedProvider = detectMobileMoneyProvider(normalizedPhone);
    const result = await initiateDirectPayment({
      amount: providerFee.totalCharged,
      phone: normalizedPhone,
      userId: slot.membership.userId,
      externalId: contribution.id,
      message: `DIVA tontine contribution — ${slot.beneficiaryName} (${tontineSession.type})`,
      medium: detectedProvider ? fapshiMediumFor(detectedProvider) : undefined,
    });

    await prisma.$transaction([
      prisma.contribution.update({
        where: { id: contribution.id },
        data: { fapshiTxRef: result.transId },
      }),
      // Durable per-attempt ledger row, independent of the mutable
      // fapshiTxRef above — lets a later webhook still recognize a
      // superseded transId that ends up succeeding anyway (double-payment
      // detection/refund, see process-fapshi-transaction.ts).
      prisma.paymentAttempt.create({
        data: {
          transId: result.transId,
          contributionId: contribution.id,
          payerPhone: normalizedPhone,
          amount: providerFee.totalCharged,
        },
      }),
    ]);

    return { ok: true, transId: result.transId };
  } catch (error) {
    await prisma.contribution.update({
      where: { id: contribution.id },
      data: {
        status: "FAILED",
        failureReason: error instanceof FapshiError ? error.message : "Payment initiation failed",
      },
    });
    if (error instanceof FapshiError) {
      return { ok: false, status: 502, error: error.message };
    }
    return { ok: false, status: 500, error: "Payment initiation failed" };
  }
}

class AlreadyPaidError extends Error {}
class PaymentInProgressError extends Error {}
