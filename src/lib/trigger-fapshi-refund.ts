import { prisma } from "@/lib/prisma";
import { initiatePayout, isPayoutConfigured, FapshiError } from "@/lib/fapshi";
import { sendWhatsAppMessageSafe } from "@/lib/whatsapp/evolution";
import { translate, type Lang } from "@/lib/i18n/translations";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import { logAudit } from "@/lib/audit";
import { formatXAF } from "@/lib/format-currency";
import type { PaymentAttempt } from "@/generated/prisma/client";

const MAX_REFUND_ATTEMPTS = 3;
const BACKOFF_BASE_MINUTES = 5; // 5, 10, 20 minutes — exponential per retry.

interface RefundTarget {
  slotLabel: string;
  payerLang: Lang;
}

async function loadRefundTarget(attempt: PaymentAttempt): Promise<RefundTarget | null> {
  if (attempt.contributionId) {
    const contribution = await prisma.contribution.findUnique({
      where: { id: attempt.contributionId },
      include: {
        membershipSlot: { include: { membership: { include: { user: true } } } },
        paidByUser: true,
      },
    });
    if (!contribution) return null;
    const payer = contribution.paidByUser ?? contribution.membershipSlot.membership.user;
    return {
      slotLabel: contribution.membershipSlot.beneficiaryName,
      payerLang: payer.preferredLang === "fr" ? "fr" : "en",
    };
  }
  if (attempt.fineId) {
    const fine = await prisma.fine.findUnique({
      where: { id: attempt.fineId },
      include: { membershipSlot: { include: { membership: { include: { user: true } } } } },
    });
    if (!fine) return null;
    const payer = fine.membershipSlot.membership.user;
    return {
      slotLabel: fine.membershipSlot.beneficiaryName,
      payerLang: payer.preferredLang === "fr" ? "fr" : "en",
    };
  }
  return null;
}

/**
 * Attempts to refund a DUPLICATE_PAID payment attempt via Fapshi's
 * payout-only service. Safe to call repeatedly (from the detection site and
 * from the retry cron) — a no-op once the row has moved out of
 * DUPLICATE_PAID. On failure, requeues with exponential backoff up to
 * MAX_REFUND_ATTEMPTS, then escalates to REFUND_FAILED_MANUAL_REVIEW and
 * notifies every admin/president.
 */
export async function triggerAutomatedRefund(paymentAttemptId: string): Promise<void> {
  const attempt = await prisma.paymentAttempt.findUnique({ where: { id: paymentAttemptId } });
  if (!attempt || attempt.status !== "DUPLICATE_PAID") return;

  const target = await loadRefundTarget(attempt);

  if (!isPayoutConfigured()) {
    await escalateToManualReview(attempt, "Fapshi payout service is not configured", target, attempt.refundAttempts);
    return;
  }

  await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "REFUND_INITIATED" } });
  await logAudit({
    action: "refund_triggered",
    targetType: "PaymentAttempt",
    targetId: attempt.id,
    metadata: { transId: attempt.transId, amount: Number(attempt.amount), reason: attempt.refundReason },
  });

  try {
    const result = await initiatePayout({
      amount: Number(attempt.amount),
      phone: attempt.payerPhone,
      externalId: `refund-${attempt.id}`,
      message: attempt.refundReason ?? "DIVA duplicate payment refund",
    });

    await prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: { status: "REFUNDED", refundTransId: result.transId, refundedAt: new Date(), lastRefundError: null },
    });

    if (target) {
      await sendWhatsAppMessageSafe(
        attempt.payerPhone,
        translate(target.payerLang, "waDuplicateRefunded", {
          amount: formatXAF(Number(attempt.amount)),
        }),
      );
    }
  } catch (error) {
    const attempts = attempt.refundAttempts + 1;
    const message = error instanceof FapshiError || error instanceof Error ? error.message : "Refund failed";

    if (attempts >= MAX_REFUND_ATTEMPTS) {
      await escalateToManualReview(attempt, message, target, attempts);
    } else {
      const backoffMs = BACKOFF_BASE_MINUTES * 2 ** (attempts - 1) * 60_000;
      await prisma.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "DUPLICATE_PAID",
          refundAttempts: attempts,
          nextRefundAttemptAt: new Date(Date.now() + backoffMs),
          lastRefundError: message,
        },
      });
    }
  }
}

async function escalateToManualReview(
  attempt: PaymentAttempt,
  message: string,
  target: RefundTarget | null,
  attempts: number,
): Promise<void> {
  await prisma.paymentAttempt.update({
    where: { id: attempt.id },
    data: {
      status: "REFUND_FAILED_MANUAL_REVIEW",
      refundAttempts: attempts,
      lastRefundError: message,
      nextRefundAttemptAt: null,
    },
  });
  await logAudit({
    action: "refund_failed_manual_review",
    targetType: "PaymentAttempt",
    targetId: attempt.id,
    status: "FAILED",
    failureReason: message,
    metadata: { transId: attempt.transId, amount: Number(attempt.amount), attempts },
  });

  const admins = await prisma.user.findMany({
    where: { role: { in: ["ADMIN", "PRESIDENT"] } },
    select: { id: true },
  });
  if (admins.length === 0) return;

  const amountLabel = formatXAF(Number(attempt.amount));
  const slotLabel = target?.slotLabel ?? "—";
  await scheduleInAppNotifications({
    type: "PAYMENT_REFUND_ESCALATED",
    recipients: admins.map((a) => ({
      userId: a.id,
      message: `Automated refund failed 3 times for a duplicate payment of ${amountLabel} on slot "${slotLabel}". Please refund the payer manually.`,
      messageKey: "paymentRefundEscalatedNotifMessage",
      messageVars: { amount: amountLabel, slot: slotLabel },
      actionUrl: "/admin/payment-issues",
    })),
  });
}
