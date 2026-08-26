"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { translate, type Lang } from "@/lib/i18n/translations";

type PayoutStatus = "DETAILS_SUBMITTED" | "RELEASED" | "CONFIRMED" | null;

export function PayoutTurnPanel({
  membershipSlotId,
  payoutId,
  status,
  lang,
}: {
  membershipSlotId: string;
  payoutId: string | null;
  status: PayoutStatus;
  lang: Lang;
}) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [accountName, setAccountName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitDetails(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/payments/payout-claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membershipSlotId, phone: phone.trim(), accountName: accountName.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? t("couldNotSubmitPayoutDetails"));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("couldNotSubmitPayoutDetails"));
      setSubmitting(false);
    }
  }

  async function confirmReceipt() {
    if (!payoutId) return;
    setConfirming(true);
    setError(null);
    try {
      const res = await fetch(`/api/payments/payout-claims/${payoutId}/confirm`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? t("couldNotSubmitPayoutDetails"));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("couldNotSubmitPayoutDetails"));
      setConfirming(false);
    }
  }

  if (status === "CONFIRMED") return null;

  return (
    <section className="mb-stack-gap-lg bg-primary/5 border border-primary/20 rounded-xl p-4">
      {status === null && (
        <>
          <p className="font-label-md text-label-md text-primary mb-3">{t("itsYourTurn")}</p>
          <form onSubmit={submitDetails} className="flex flex-col gap-3">
            <div>
              <label className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
                {t("payoutPhoneLabel")}
              </label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md bg-white"
              />
            </div>
            <div>
              <label className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
                {t("payoutAccountNameLabel")}
              </label>
              <input
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                required
                className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md bg-white"
              />
            </div>
            {error && <p className="font-label-sm text-label-sm text-error">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 disabled:opacity-60"
            >
              {t("submitPayoutDetails")}
            </button>
          </form>
        </>
      )}

      {status === "DETAILS_SUBMITTED" && (
        <p className="font-label-md text-label-md text-on-surface">{t("payoutDetailsSubmitted")}</p>
      )}

      {status === "RELEASED" && (
        <div className="flex flex-col gap-3">
          <p className="font-label-md text-label-md text-on-surface">{t("payoutSentToYou")}</p>
          {error && <p className="font-label-sm text-label-sm text-error">{error}</p>}
          <button
            onClick={confirmReceipt}
            disabled={confirming}
            className="w-full py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 disabled:opacity-60"
          >
            {t("iReceivedMyPayout")}
          </button>
        </div>
      )}
    </section>
  );
}
