"use client";

import { useEffect, useState } from "react";
import { translate, type Lang } from "@/lib/i18n/translations";
import { parseJsonOrThrow, friendlyErrorMessage } from "@/lib/api-error";
import { LoadingSpinner } from "@/components/loading-spinner";
import { formatXAF } from "@/lib/format-currency";

interface PaymentIssue {
  id: string;
  transId: string;
  slotName: string | null;
  amount: number;
  payerPhone: string;
  status: "DUPLICATE_PAID" | "REFUND_INITIATED" | "REFUND_FAILED_MANUAL_REVIEW" | "REFUNDED";
  refundReason: string | null;
  refundAttempts: number;
  lastRefundError: string | null;
  refundedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const STATUS_KEY: Record<PaymentIssue["status"], Parameters<typeof translate>[1]> = {
  DUPLICATE_PAID: "paymentIssueStatusDuplicatePaid",
  REFUND_INITIATED: "paymentIssueStatusRefundInitiated",
  REFUND_FAILED_MANUAL_REVIEW: "paymentIssueStatusRefundFailedManualReview",
  REFUNDED: "paymentIssueStatusRefunded",
};

const STATUS_BADGE: Record<PaymentIssue["status"], string> = {
  DUPLICATE_PAID: "bg-secondary-fixed-dim/20 text-on-secondary-fixed-variant",
  REFUND_INITIATED: "bg-secondary-fixed-dim/20 text-on-secondary-fixed-variant",
  REFUND_FAILED_MANUAL_REVIEW: "bg-error/10 text-error",
  REFUNDED: "bg-primary/10 text-primary",
};

export function PaymentIssuesClient({ lang }: { lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const [issues, setIssues] = useState<PaymentIssue[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    fetch("/api/admin/payment-issues")
      .then((r) => r.json())
      .then((b) => setIssues(b.issues ?? []));
  }

  useEffect(refresh, []);

  async function retry(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/payment-issues/${id}/retry`, { method: "POST" });
      await parseJsonOrThrow(res, t("paymentIssueRetryFailed"));
      refresh();
    } catch (err) {
      setError(friendlyErrorMessage(err, t("paymentIssueRetryFailed")));
    } finally {
      setBusyId(null);
    }
  }

  async function resolve(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/payment-issues/${id}/resolve`, { method: "POST" });
      await parseJsonOrThrow(res, t("paymentIssueResolveFailed"));
      refresh();
    } catch (err) {
      setError(friendlyErrorMessage(err, t("paymentIssueResolveFailed")));
    } finally {
      setBusyId(null);
    }
  }

  if (!issues) {
    return <LoadingSpinner fullPage />;
  }

  if (issues.length === 0) {
    return <p className="font-label-sm text-label-sm text-on-surface-variant">{t("paymentIssuesEmptyState")}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="font-label-sm text-label-sm text-error">{error}</p>}
      <div className="flex flex-col gap-0 border border-outline-variant/30 rounded-lg overflow-hidden">
        {issues.map((issue) => (
          <div key={issue.id} className="flex flex-col gap-2 p-3 bg-surface-container-lowest border-b last:border-b-0 border-outline-variant/30">
            <div className="flex items-center justify-between gap-2">
              <p className="font-label-md text-label-md text-on-surface truncate">{issue.slotName ?? "—"}</p>
              <span className={`px-2 py-0.5 rounded-full font-label-sm text-[11px] flex-shrink-0 ${STATUS_BADGE[issue.status]}`}>
                {t(STATUS_KEY[issue.status])}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-label-sm text-label-sm">
              <span className="text-on-surface-variant">{t("paymentIssueAmountLabel")}</span>
              <span className="text-on-surface">{formatXAF(issue.amount)}</span>
              <span className="text-on-surface-variant">{t("paymentIssuePayerLabel")}</span>
              <span className="text-on-surface">{issue.payerPhone}</span>
              <span className="text-on-surface-variant">{t("paymentIssueAttemptsLabel")}</span>
              <span className="text-on-surface">{issue.refundAttempts}/3</span>
            </div>
            {issue.status === "REFUND_FAILED_MANUAL_REVIEW" && issue.lastRefundError && (
              <p className="font-label-sm text-[11px] text-error">{issue.lastRefundError}</p>
            )}
            {issue.status !== "REFUNDED" && (
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => retry(issue.id)}
                  disabled={busyId === issue.id}
                  className="px-2 py-1 rounded border border-outline-variant text-on-surface-variant font-label-sm text-label-sm hover:bg-surface disabled:opacity-60"
                >
                  {t("paymentIssueRetryButton")}
                </button>
                <button
                  onClick={() => resolve(issue.id)}
                  disabled={busyId === issue.id}
                  className="px-2 py-1 rounded bg-primary text-on-primary font-label-sm text-label-sm hover:opacity-90 disabled:opacity-60"
                >
                  {t("paymentIssueResolveButton")}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
