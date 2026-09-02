import { prisma } from "@/lib/prisma";
import { getContributionTotal, getNextDueDate } from "@/lib/tontine-engine";
import { initiateDirectPayment, normalizeCameroonPhone, FapshiError } from "@/lib/fapshi";
import { assertPriorCyclePaidOut } from "@/lib/round-robin-lock";
import { computeProviderFee } from "@/lib/payment-fees";
import type { PaymentProvider } from "@/generated/prisma/enums";

const MAX_SLOTS_PER_BULK_PAYMENT = 20;
// Same window used by initiate-slot-payment.ts's single-slot race guard.
const IN_FLIGHT_WINDOW_MS = 10 * 60 * 1000;

export interface BulkPaymentQuoteItem {
  membershipSlotId: string;
  beneficiaryName: string;
  sessionLabel: string;
  amount: number;
  fee: number;
  fineAmount: number;
  baseTotal: number;
}

export interface BulkPaymentQuote {
  items: BulkPaymentQuoteItem[];
  baseTotal: number;
  provider: PaymentProvider;
  providerFeeAmount: number;
  totalCharged: number;
}

export type BulkPaymentQuoteResult = { ok: true; quote: BulkPaymentQuote } | { ok: false; status: number; error: string };

export type InitiateBulkPaymentResult = { ok: true; transId: string } | { ok: false; status: number; error: string };

const TONTINE_LABELS: Record<string, string> = {
  HEBDO_SUNDAY: "Weekly Tontine (Sunday)",
  MONTHLY_28: "Monthly Tontine (28th)",
  MONTHLY_25: "Monthly Tontine (25th)",
};

/**
 * Loads and validates every requested slot for a bulk payment — shared by
 * the read-only quote and the real initiate call, which re-derives
 * everything itself rather than trusting the quote (same "never trust a
 * cached preview" discipline as getSlotPaymentQuote/initiateSlotPayment).
 * Scoped to the caller's OWN slots only — v1 doesn't combine self-pay with
 * paying for someone else's names in one transaction.
 */
async function loadAndValidateSlots(userId: string, membershipSlotIds: string[], now: Date) {
  const uniqueIds = [...new Set(membershipSlotIds)].sort();
  if (uniqueIds.length === 0) {
    return { ok: false as const, status: 400, error: "Select at least one name to pay for" };
  }
  if (uniqueIds.length > MAX_SLOTS_PER_BULK_PAYMENT) {
    return { ok: false as const, status: 400, error: "Please select fewer names for one combined payment" };
  }

  const slots = await prisma.membershipSlot.findMany({
    where: { id: { in: uniqueIds } },
    include: { membership: { include: { tontineSession: true } } },
  });
  if (slots.length !== uniqueIds.length) {
    return { ok: false as const, status: 404, error: "One or more selected names could not be found" };
  }

  const roundLockCache = new Map<string, Awaited<ReturnType<typeof assertPriorCyclePaidOut>>>();
  for (const slot of slots) {
    if (slot.membership.userId !== userId) {
      return { ok: false as const, status: 403, error: "You can only include your own names in a combined payment" };
    }
    if (slot.membership.status !== "APPROVED" || slot.membership.tontineSession.status !== "ACTIVE") {
      return { ok: false as const, status: 409, error: `${slot.beneficiaryName} isn't currently accepting contributions` };
    }
    if (slot.membership.tontineSession.isPaused) {
      return { ok: false as const, status: 409, error: `${slot.beneficiaryName}'s cotisation is temporarily paused` };
    }

    const tontineSessionId = slot.membership.tontineSessionId;
    if (!roundLockCache.has(tontineSessionId)) {
      const dueDate = getNextDueDate(slot.membership.tontineSession.type, now);
      roundLockCache.set(
        tontineSessionId,
        await assertPriorCyclePaidOut(
          tontineSessionId,
          slot.membership.tontineSession.type,
          dueDate,
          slot.membership.tontineSession.startDate,
        ),
      );
    }
    const roundLock = roundLockCache.get(tontineSessionId)!;
    if (!roundLock.ok) {
      return { ok: false as const, status: roundLock.status, error: `${slot.beneficiaryName}: ${roundLock.error}` };
    }
  }

  return { ok: true as const, slots, uniqueIds };
}

export interface UnpaidSlotSummary {
  membershipSlotId: string;
  beneficiaryName: string;
  sessionLabel: string;
  tontineSessionId: string;
  baseTotal: number;
  locked: boolean;
  lockedReason?: string;
}

/**
 * Lists every one of a member's own slots, across all their active
 * cotisations, that's unpaid for the current cycle — the source list for
 * the Global Payment selection screen. Slots blocked by the round-robin
 * lock are still listed (so the member understands why a name is missing
 * from the option to pay) but flagged `locked` rather than omitted.
 */
export async function listUnpaidSlotsForBulkPayment(userId: string): Promise<UnpaidSlotSummary[]> {
  const now = new Date();
  const memberships = await prisma.membership.findMany({
    where: { userId, status: "APPROVED", tontineSession: { status: "ACTIVE" } },
    include: { tontineSession: true, slots: true },
  });

  const roundLockCache = new Map<string, Awaited<ReturnType<typeof assertPriorCyclePaidOut>>>();
  const results: UnpaidSlotSummary[] = [];

  for (const membership of memberships) {
    if (membership.tontineSession.isPaused) continue;
    const { tontineSession } = membership;
    const dueDate = getNextDueDate(tontineSession.type, now);

    if (!roundLockCache.has(membership.tontineSessionId)) {
      roundLockCache.set(
        membership.tontineSessionId,
        await assertPriorCyclePaidOut(membership.tontineSessionId, tontineSession.type, dueDate, tontineSession.startDate),
      );
    }
    const roundLock = roundLockCache.get(membership.tontineSessionId)!;

    for (const slot of membership.slots) {
      const existing = await prisma.contribution.findUnique({
        where: { membershipSlotId_dueDate: { membershipSlotId: slot.id, dueDate } },
      });
      if (existing?.status === "PAID") continue;
      if (existing?.status === "PENDING" && existing.fapshiTxRef) continue;

      const { amount, fee } = getContributionTotal({ amount: Number(tontineSession.amount), fee: Number(tontineSession.fee) });
      const outstandingFine = await prisma.fine.findUnique({
        where: { membershipSlotId_dueDate: { membershipSlotId: slot.id, dueDate } },
      });
      const fineAmount = outstandingFine?.status === "UNPAID" ? Number(outstandingFine.amount) : 0;

      results.push({
        membershipSlotId: slot.id,
        beneficiaryName: slot.beneficiaryName,
        sessionLabel: tontineSession.title || TONTINE_LABELS[tontineSession.type] || tontineSession.type,
        tontineSessionId: membership.tontineSessionId,
        baseTotal: amount + fee + fineAmount,
        locked: !roundLock.ok,
        lockedReason: roundLock.ok ? undefined : roundLock.error,
      });
    }
  }

  return results;
}

/** Read-only preview for the Global Payment confirmation screen. */
export async function getBulkPaymentQuote(userId: string, membershipSlotIds: string[]): Promise<BulkPaymentQuoteResult> {
  const now = new Date();
  const validated = await loadAndValidateSlots(userId, membershipSlotIds, now);
  if (!validated.ok) return validated;

  const items: BulkPaymentQuoteItem[] = [];
  for (const slot of validated.slots) {
    const { tontineSession } = slot.membership;
    const dueDate = getNextDueDate(tontineSession.type, now);
    const existing = await prisma.contribution.findUnique({
      where: { membershipSlotId_dueDate: { membershipSlotId: slot.id, dueDate } },
    });
    if (existing?.status === "PAID") {
      return { ok: false, status: 409, error: `${slot.beneficiaryName} is already paid for this cycle` };
    }

    const { amount, fee } = getContributionTotal({ amount: Number(tontineSession.amount), fee: Number(tontineSession.fee) });
    const outstandingFine = await prisma.fine.findUnique({
      where: { membershipSlotId_dueDate: { membershipSlotId: slot.id, dueDate } },
    });
    const fineAmount = outstandingFine && outstandingFine.status === "UNPAID" ? Number(outstandingFine.amount) : 0;
    const baseTotal = amount + fee + fineAmount;

    items.push({
      membershipSlotId: slot.id,
      beneficiaryName: slot.beneficiaryName,
      sessionLabel: tontineSession.title || TONTINE_LABELS[tontineSession.type] || tontineSession.type,
      amount,
      fee,
      fineAmount,
      baseTotal,
    });
  }

  const baseTotal = items.reduce((sum, item) => sum + item.baseTotal, 0);
  const provider: PaymentProvider = "FAPSHI";
  const providerFee = computeProviderFee(provider, baseTotal);

  return {
    ok: true,
    quote: { items, baseTotal, provider, providerFeeAmount: providerFee.providerFeeAmount, totalCharged: providerFee.totalCharged },
  };
}

/**
 * Combines several of a member's own unpaid slots (possibly across
 * different cotisations) into a single Fapshi USSD prompt instead of one
 * per slot. Locks every involved slot (sorted by id first, so two
 * overlapping bulk payments always acquire locks in the same order and
 * can't deadlock each other) before claiming any of them, mirroring
 * initiateSlotPayment's single-slot anti-race pattern.
 */
export async function initiateBulkPayment(
  userId: string,
  membershipSlotIds: string[],
  phone: string,
): Promise<InitiateBulkPaymentResult> {
  const normalizedPhone = normalizeCameroonPhone(phone);
  if (!normalizedPhone) {
    return { ok: false, status: 400, error: "Please enter a valid Mobile Money / Orange Money number" };
  }

  const now = new Date();
  const validated = await loadAndValidateSlots(userId, membershipSlotIds, now);
  if (!validated.ok) return validated;
  const { slots, uniqueIds } = validated;

  const provider: PaymentProvider = "FAPSHI";

  let bulkPayment: { id: string };
  let totalCharged!: number;
  try {
    bulkPayment = await prisma.$transaction(async (tx) => {
      for (const id of uniqueIds) {
        await tx.$queryRaw`SELECT id FROM membership_slots WHERE id = ${id} FOR UPDATE`;
      }

      const items: { slotId: string; beneficiaryName: string; dueDate: Date; amount: number; fee: number; fineAmount: number }[] = [];
      let baseTotal = 0;
      for (const slot of slots) {
        const { tontineSession } = slot.membership;
        const dueDate = getNextDueDate(tontineSession.type, now);
        const existing = await tx.contribution.findUnique({
          where: { membershipSlotId_dueDate: { membershipSlotId: slot.id, dueDate } },
        });
        if (existing?.status === "PAID") {
          throw new SlotUnavailableError(`${slot.beneficiaryName} is already paid for this cycle`);
        }
        if (
          existing?.status === "PENDING" &&
          existing.fapshiTxRef &&
          Date.now() - existing.updatedAt.getTime() < IN_FLIGHT_WINDOW_MS
        ) {
          throw new SlotUnavailableError(`A payment is already in progress for ${slot.beneficiaryName}`);
        }

        const { amount, fee } = getContributionTotal({ amount: Number(tontineSession.amount), fee: Number(tontineSession.fee) });
        const outstandingFine = await tx.fine.findUnique({
          where: { membershipSlotId_dueDate: { membershipSlotId: slot.id, dueDate } },
        });
        const fineAmount = outstandingFine?.status === "UNPAID" ? Number(outstandingFine.amount) : 0;
        baseTotal += amount + fee + fineAmount;
        items.push({ slotId: slot.id, beneficiaryName: slot.beneficiaryName, dueDate, amount, fee, fineAmount });
      }

      const combinedFee = computeProviderFee(provider, baseTotal);
      totalCharged = combinedFee.totalCharged;

      const created = await tx.bulkPayment.create({
        data: { userId, payerPhone: normalizedPhone, amount: combinedFee.totalCharged, status: "PENDING" },
      });

      for (const item of items) {
        // Each slot's own fee/share breakdown is computed on ITS OWN base
        // total (not a proportional slice of the combined fee) — matches
        // Fapshi's real per-slot economics closely enough for reporting,
        // may differ from the combined total by a franc or two of rounding.
        const slotFee = computeProviderFee(provider, item.amount + item.fee + item.fineAmount);
        const data = {
          amountPaid: item.amount,
          feePaid: item.fee,
          finePaid: item.fineAmount,
          status: "PENDING" as const,
          payerPhone: normalizedPhone,
          failureReason: null,
          bulkPaymentId: created.id,
          paymentProvider: provider,
          providerFeeAmount: slotFee.providerFeeAmount,
          providerShareAmount: slotFee.providerShareAmount,
          presidentFeeShareAmount: slotFee.presidentFeeShareAmount,
        };
        const existing = await tx.contribution.findUnique({
          where: { membershipSlotId_dueDate: { membershipSlotId: item.slotId, dueDate: item.dueDate } },
        });
        if (existing) {
          await tx.contribution.update({ where: { id: existing.id }, data });
        } else {
          await tx.contribution.create({ data: { membershipSlotId: item.slotId, dueDate: item.dueDate, ...data } });
        }
      }

      return created;
    });
  } catch (err) {
    if (err instanceof SlotUnavailableError) {
      return { ok: false, status: 409, error: err.message };
    }
    throw err;
  }

  const names = slots.map((s) => s.beneficiaryName);
  const namesLabel = names.length > 3 ? `${names.slice(0, 3).join(", ")}…` : names.join(", ");

  try {
    const result = await initiateDirectPayment({
      amount: totalCharged,
      phone: normalizedPhone,
      userId,
      externalId: bulkPayment.id,
      message: `DIVA tontine — combined payment for ${names.length} names: ${namesLabel}`,
    });

    await prisma.$transaction([
      prisma.bulkPayment.update({ where: { id: bulkPayment.id }, data: { transId: result.transId } }),
      prisma.paymentAttempt.create({
        data: {
          transId: result.transId,
          bulkPaymentId: bulkPayment.id,
          payerPhone: normalizedPhone,
          amount: totalCharged,
        },
      }),
    ]);

    return { ok: true, transId: result.transId };
  } catch (error) {
    const failureReason = error instanceof FapshiError ? error.message : "Payment initiation failed";
    await prisma.$transaction([
      prisma.bulkPayment.update({ where: { id: bulkPayment.id }, data: { status: "FAILED", failureReason } }),
      prisma.contribution.updateMany({ where: { bulkPaymentId: bulkPayment.id }, data: { status: "FAILED", failureReason } }),
    ]);
    if (error instanceof FapshiError) {
      return { ok: false, status: 502, error: error.message };
    }
    return { ok: false, status: 500, error: "Payment initiation failed" };
  }
}

class SlotUnavailableError extends Error {}
