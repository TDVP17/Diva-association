"use client";

import { useState } from "react";
import { translate, type Lang } from "@/lib/i18n/translations";
import { PaymentConfirmDialog } from "@/components/payment-confirm-dialog";
import { parseJsonOrThrow, friendlyErrorMessage } from "@/lib/api-error";

interface FoundMember {
  memberCode: string;
  name: string;
  avatar: string | null;
  hasUnpaidFines: boolean;
  totalUnpaidFines: number;
}

interface FundableSlot {
  slotId: string;
  beneficiaryName: string;
  tontineSessionId: string;
  tontineSessionTitle: string;
  amount: number;
  alreadyPaid: boolean;
}

export function ContributeForRelativeClient({ lang }: { lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);

  const [code, setCode] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [member, setMember] = useState<FoundMember | null>(null);
  const [slots, setSlots] = useState<FundableSlot[]>([]);
  const [payingSlotId, setPayingSlotId] = useState<string | null>(null);
  const [confirmSlotId, setConfirmSlotId] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);

  async function findMember() {
    const trimmed = code.trim();
    if (!trimmed) return;
    setSearching(true);
    setSearchError(null);
    try {
      const lookupRes = await fetch(`/api/members/lookup-code?code=${encodeURIComponent(trimmed)}`);
      const lookupBody = await lookupRes.json();
      if (!lookupRes.ok) {
        setSearchError(lookupBody.error ?? t("noMemberFoundWithCode"));
        return;
      }
      setMember(lookupBody);

      const membershipsRes = await fetch(`/api/members/${encodeURIComponent(lookupBody.memberCode)}/memberships`);
      const membershipsBody = await membershipsRes.json();
      setSlots(membershipsRes.ok ? (membershipsBody.slots ?? []) : []);
    } catch {
      setSearchError(t("noMemberFoundWithCode"));
    } finally {
      setSearching(false);
    }
  }

  function reset() {
    setMember(null);
    setSlots([]);
    setCode("");
    setSearchError(null);
    setPayError(null);
  }

  async function payForSlot(slotId: string) {
    setPayingSlotId(slotId);
    setPayError(null);
    try {
      const res = await fetch("/api/payments/relative/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membershipSlotId: slotId }),
      });
      const body = await parseJsonOrThrow<{ paymentUrl: string }>(res, t("paymentInitiationFailed"));
      window.location.assign(body.paymentUrl);
    } catch (err) {
      setPayError(friendlyErrorMessage(err, t("paymentInitiationFailed")));
      setPayingSlotId(null);
      setConfirmSlotId(null);
    }
  }

  if (!member) {
    return (
      <div className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant p-5 flex flex-col gap-4">
        <div>
          <label htmlFor="member-code" className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
            {t("enterMemberCode")}
          </label>
          <input
            id="member-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t("memberCodePlaceholder")}
            className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md uppercase tracking-wide"
          />
        </div>
        {searchError && <p className="font-label-sm text-label-sm text-error">{searchError}</p>}
        <button
          onClick={findMember}
          disabled={!code.trim() || searching}
          className="w-full py-3 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 active:scale-95 transition-all disabled:opacity-60"
        >
          {searching ? t("searchingEllipsis") : t("findMember")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-tertiary-container text-on-tertiary flex items-center justify-center font-label-md text-label-md overflow-hidden flex-shrink-0">
          {member.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={member.avatar} alt={member.name} className="w-full h-full object-cover" />
          ) : (
            member.name.slice(0, 2).toUpperCase()
          )}
        </div>
        <div className="min-w-0">
          <p className="font-label-sm text-label-sm text-on-surface-variant">{t("contributingFor")}</p>
          <p className="font-label-md text-label-md text-on-surface truncate">{member.name}</p>
        </div>
      </div>

      {member.hasUnpaidFines && (
        <div className="bg-error-container/40 border border-error/30 rounded-xl p-3 flex items-center gap-2">
          <span className="material-symbols-outlined text-error text-[18px]">warning</span>
          <p className="font-label-sm text-label-sm text-on-error-container">
            {t("memberHasUnpaidFines", { amount: member.totalUnpaidFines.toLocaleString("en-US") })}
          </p>
        </div>
      )}

      <button onClick={reset} className="font-label-sm text-label-sm text-primary underline self-start">
        {t("notThisPerson")}
      </button>

      <div>
        <h2 className="font-label-md text-label-md text-on-surface mb-2">{t("whichContributionToFund")}</h2>
        {slots.length === 0 ? (
          <div className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant p-5 text-center">
            <p className="font-body-md text-body-md text-on-surface-variant">
              {t("noAvailableContributionsForMember")}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {slots.map((s) => (
              <div
                key={s.slotId}
                className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant p-4 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="font-label-md text-label-md text-on-surface truncate">{s.tontineSessionTitle}</p>
                  <p className="font-label-sm text-label-sm text-on-surface-variant truncate">
                    {s.beneficiaryName} — {s.amount.toLocaleString("en-US")} F
                  </p>
                </div>
                <button
                  onClick={() => setConfirmSlotId(s.slotId)}
                  disabled={s.alreadyPaid || payingSlotId === s.slotId}
                  className="flex-shrink-0 px-3 py-2 rounded-lg bg-primary text-on-primary font-label-sm text-label-sm hover:opacity-90 disabled:opacity-50 disabled:bg-surface-variant disabled:text-on-surface-variant"
                >
                  {s.alreadyPaid
                    ? t("alreadyContributed")
                    : payingSlotId === s.slotId
                      ? t("redirectingToFapshi")
                      : t("payViaFapshi")}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      {payError && <p className="font-label-sm text-label-sm text-error">{payError}</p>}
      {confirmSlotId && (
        <PaymentConfirmDialog
          lang={lang}
          membershipSlotId={confirmSlotId}
          onConfirm={() => payForSlot(confirmSlotId)}
          onClose={() => setConfirmSlotId(null)}
        />
      )}
    </div>
  );
}
