import { prisma } from "@/lib/prisma";
import { getPaymentStatus, type FapshiPaymentStatus, type PaymentStatusResult } from "@/lib/fapshi";
import { settleContribution } from "@/lib/settle-contribution";
import { settleFine } from "@/lib/settle-fine";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import { triggerAutomatedRefund } from "@/lib/trigger-fapshi-refund";
import type { PaymentAttempt } from "@/generated/prisma/client";

const TONTINE_LABELS: Record<string, string> = {
  HEBDO_SUNDAY: "Weekly Tontine (Sunday)",
  MONTHLY_28: "Monthly Tontine (28th)",
  MONTHLY_25: "Monthly Tontine (25th)",
};

export interface ProcessedTransaction {
  status: FapshiPaymentStatus;
  alreadyProcessed?: boolean;
  /** This transId succeeded on Fapshi's side after its slot was already paid by a different transaction — queued for automated refund. */
  duplicate?: boolean;
  failureReason?: string | null;
}

/**
 * Re-verifies a Fapshi transaction against Fapshi's own API (never trusts a
 * caller-supplied status) and, the first time it sees SUCCESSFUL/FAILED/
 * EXPIRED, settles or fails the matching Contribution or Fine — idempotent,
 * so it's safe to call from both the webhook (push, authoritative) and the
 * member-facing status-poll endpoint (pull, backup for when the webhook is
 * slow or never arrives) without ever double-crediting a payment.
 *
 * A SUCCESSFUL transaction whose target is already PAID by a *different*
 * transId (the double-payment race — e.g. a member and a relative paying
 * the same slot at once) is flagged DUPLICATE_PAID and queued for an
 * automated refund instead of being silently discarded or double-credited.
 */
export async function processFapshiTransaction(transId: string, origin: string): Promise<ProcessedTransaction> {
  const verified = await getPaymentStatus(transId);

  if (verified.status === "SUCCESSFUL") {
    return await handleSuccessful(transId, verified, origin);
  }

  if (verified.status === "FAILED" || verified.status === "EXPIRED") {
    return await handleFailedOrExpired(transId, verified);
  }

  return { status: verified.status };
}

async function handleSuccessful(
  transId: string,
  verified: PaymentStatusResult,
  origin: string,
): Promise<ProcessedTransaction> {
  const attempt = await prisma.paymentAttempt.findUnique({ where: { transId } });

  if (attempt?.contributionId) {
    return await settleOrFlagContribution(attempt, verified, origin);
  }
  if (attempt?.fineId) {
    return await settleOrFlagFine(attempt);
  }

  // No ledger row — a transaction initiated before the PaymentAttempt table
  // existed. Falls back to the old direct-match-by-fapshiTxRef behavior;
  // duplicate detection only applies to attempts recorded going forward.
  return await legacySettleByTxRef(transId, verified, origin);
}

async function settleOrFlagContribution(
  attempt: PaymentAttempt,
  verified: PaymentStatusResult,
  origin: string,
): Promise<ProcessedTransaction> {
  const transId = attempt.transId;
  const paidAt = verified.dateConfirmed ? new Date(verified.dateConfirmed) : new Date();

  // Row-locked check-and-claim: the first SUCCESSFUL transaction to reach
  // here for this contribution atomically claims PAID status (fast, no
  // external calls while the lock is held); a second concurrent webhook for
  // a different transId then sees PAID and is flagged as a duplicate
  // instead of double-crediting or silently discarding it.
  const outcome = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM contributions WHERE id = ${attempt.contributionId} FOR UPDATE`;
    const fresh = await tx.contribution.findUnique({ where: { id: attempt.contributionId! } });
    if (!fresh) return { kind: "missing" as const };
    if (fresh.status === "PAID") {
      return fresh.fapshiTxRef === transId ? ({ kind: "alreadyProcessed" as const }) : ({ kind: "duplicate" as const });
    }
    await tx.contribution.update({ where: { id: fresh.id }, data: { status: "PAID", paidAt, fapshiTxRef: transId } });
    return { kind: "winner" as const };
  });

  if (outcome.kind === "missing") return { status: "SUCCESSFUL" };

  if (outcome.kind === "alreadyProcessed") {
    await prisma.paymentAttempt.updateMany({
      where: { id: attempt.id, status: { notIn: ["REFUNDED", "REFUND_INITIATED"] } },
      data: { status: "SUCCESSFUL" },
    });
    return { status: "SUCCESSFUL", alreadyProcessed: true };
  }

  if (outcome.kind === "duplicate") {
    const slot = await prisma.membershipSlot.findFirst({
      where: { contributions: { some: { id: attempt.contributionId! } } },
      select: { beneficiaryName: true },
    });
    await flagDuplicate(attempt, slot?.beneficiaryName ?? "—");
    return { status: "SUCCESSFUL", duplicate: true };
  }

  // winner — finish settlement (receipt/notifications) now that PAID is claimed.
  const contribution = await prisma.contribution.findUnique({
    where: { id: attempt.contributionId! },
    include: {
      membershipSlot: { include: { membership: { include: { user: true, tontineSession: true } } } },
      paidByUser: true,
    },
  });
  if (!contribution) return { status: "SUCCESSFUL" };

  await settleContribution(contribution, { paidAt, origin });
  await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "SUCCESSFUL" } });
  return { status: "SUCCESSFUL" };
}

async function settleOrFlagFine(attempt: PaymentAttempt): Promise<ProcessedTransaction> {
  const transId = attempt.transId;

  const outcome = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM fines WHERE id = ${attempt.fineId} FOR UPDATE`;
    const fresh = await tx.fine.findUnique({ where: { id: attempt.fineId! } });
    if (!fresh) return { kind: "missing" as const };
    if (fresh.status === "PAID" || fresh.status === "DEDUCTED") {
      return fresh.fapshiTxRef === transId ? ({ kind: "alreadyProcessed" as const }) : ({ kind: "duplicate" as const });
    }
    await tx.fine.update({ where: { id: fresh.id }, data: { status: "PAID", fapshiTxRef: transId } });
    return { kind: "winner" as const };
  });

  if (outcome.kind === "missing") return { status: "SUCCESSFUL" };

  if (outcome.kind === "alreadyProcessed") {
    await prisma.paymentAttempt.updateMany({
      where: { id: attempt.id, status: { notIn: ["REFUNDED", "REFUND_INITIATED"] } },
      data: { status: "SUCCESSFUL" },
    });
    return { status: "SUCCESSFUL", alreadyProcessed: true };
  }

  if (outcome.kind === "duplicate") {
    const slot = await prisma.membershipSlot.findFirst({
      where: { fines: { some: { id: attempt.fineId! } } },
      select: { beneficiaryName: true },
    });
    await flagDuplicate(attempt, slot?.beneficiaryName ?? "—");
    return { status: "SUCCESSFUL", duplicate: true };
  }

  const fine = await prisma.fine.findUnique({
    where: { id: attempt.fineId! },
    include: { membershipSlot: { include: { membership: { include: { user: true, tontineSession: true } } } } },
  });
  if (!fine) return { status: "SUCCESSFUL" };

  await settleFine(fine);
  await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "SUCCESSFUL" } });
  return { status: "SUCCESSFUL" };
}

async function flagDuplicate(attempt: PaymentAttempt, slotLabel: string): Promise<void> {
  await prisma.paymentAttempt.update({
    where: { id: attempt.id },
    data: {
      status: "DUPLICATE_PAID",
      refundReason: `Refund: Duplicate payment detected for slot ${slotLabel}`,
      nextRefundAttemptAt: new Date(),
    },
  });
  // Best-effort immediate attempt so the payer is refunded as fast as
  // possible; the retry cron is the durable backstop if this throws.
  try {
    await triggerAutomatedRefund(attempt.id);
  } catch (error) {
    console.error("[refund] immediate duplicate-payment refund attempt failed:", error);
  }
}

async function legacySettleByTxRef(
  transId: string,
  verified: PaymentStatusResult,
  origin: string,
): Promise<ProcessedTransaction> {
  const contribution = await prisma.contribution.findUnique({
    where: { fapshiTxRef: transId },
    include: {
      membershipSlot: { include: { membership: { include: { user: true, tontineSession: true } } } },
      paidByUser: true,
    },
  });
  if (contribution) {
    if (contribution.status === "PAID") {
      return { status: "SUCCESSFUL", alreadyProcessed: true };
    }
    const paidAt = verified.dateConfirmed ? new Date(verified.dateConfirmed) : new Date();
    await settleContribution(contribution, { paidAt, origin });
    return { status: "SUCCESSFUL" };
  }

  const fine = await prisma.fine.findUnique({
    where: { fapshiTxRef: transId },
    include: { membershipSlot: { include: { membership: { include: { user: true, tontineSession: true } } } } },
  });
  if (fine) {
    if (fine.status === "PAID") {
      return { status: "SUCCESSFUL", alreadyProcessed: true };
    }
    await settleFine(fine);
    return { status: "SUCCESSFUL" };
  }

  return { status: "SUCCESSFUL" };
}

async function handleFailedOrExpired(transId: string, verified: PaymentStatusResult): Promise<ProcessedTransaction> {
  const failureReason = verified.reason ?? null;

  await prisma.paymentAttempt.updateMany({
    where: { transId, status: "PENDING" },
    data: { status: verified.status === "FAILED" ? "FAILED" : "EXPIRED" },
  });

  const contribution = await prisma.contribution.findUnique({
    where: { fapshiTxRef: transId },
    include: { membershipSlot: { include: { membership: { include: { tontineSession: true } } } } },
  });
  if (contribution && contribution.status !== "PAID" && contribution.status !== "FAILED") {
    await prisma.contribution.update({
      where: { id: contribution.id },
      data: { status: "FAILED", failureReason },
    });
    const { membership } = contribution.membershipSlot;
    const sessionLabel = membership.tontineSession.title || TONTINE_LABELS[membership.tontineSession.type] || membership.tontineSession.type;
    const amount = Number(contribution.amountPaid) + Number(contribution.feePaid) + Number(contribution.finePaid);
    await scheduleInAppNotifications({
      tontineSessionId: membership.tontineSessionId,
      type: "PAYMENT_FAILED",
      recipients: [
        {
          userId: membership.userId,
          message: `Your ${amount.toLocaleString("en-US")} F payment for ${sessionLabel} did not go through. Please try again.`,
          messageKey: "paymentFailedNotifMessage",
          messageVars: { amount: amount.toLocaleString("en-US"), session: sessionLabel },
          actionUrl: `/sessions/${membership.tontineSessionId}`,
        },
      ],
    });
  }

  const fine = await prisma.fine.findUnique({
    where: { fapshiTxRef: transId },
    include: { membershipSlot: { include: { membership: { include: { tontineSession: true } } } } },
  });
  if (fine && fine.status !== "PAID" && fine.status !== "DEDUCTED" && fine.status !== "FAILED") {
    await prisma.fine.update({
      where: { id: fine.id },
      data: { status: "FAILED", failureReason },
    });
    const { membership } = fine.membershipSlot;
    const sessionLabel = membership.tontineSession.title || TONTINE_LABELS[membership.tontineSession.type] || membership.tontineSession.type;
    await scheduleInAppNotifications({
      tontineSessionId: membership.tontineSessionId,
      type: "PAYMENT_FAILED",
      recipients: [
        {
          userId: membership.userId,
          message: `Your ${Number(fine.amount).toLocaleString("en-US")} F fine payment for ${sessionLabel} did not go through. Please try again.`,
          messageKey: "paymentFailedNotifMessage",
          messageVars: { amount: Number(fine.amount).toLocaleString("en-US"), session: sessionLabel },
          actionUrl: "/fines",
        },
      ],
    });
  }

  return { status: verified.status, failureReason };
}
