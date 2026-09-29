"use client";

import { useEffect, useState, useRef } from "react";
import { translate, type Lang } from "@/lib/i18n/translations";
import { PaymentConfirmDialog } from "@/components/payment-confirm-dialog";
import { formatXAF } from "@/lib/format-currency";

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

/**
 * Enter a member's personal code → see every active cotisation cycle they
 * still owe → pay one via Fapshi. Shared by the authenticated "Contribute
 * for a Relative" page (payEndpoint records paidByUserId) and the public,
 * no-account /pay entry point (payEndpoint is anonymous) — same flow,
 * different endpoint depending on whether the payer is signed in.
 *
 * When an `initialCode` is provided (e.g. from a shared link), the flow
 * auto-searches on mount so the payer sees the member's unpaid cotisations
 * immediately without needing to type anything.
 */
export function MemberCodePayFlow({
  lang,
  payEndpoint,
  initialCode,
}: {
  lang: Lang;
  payEndpoint: string;
  initialCode?: string;
}) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);

  const [code, setCode] = useState(initialCode?.trim().toUpperCase() ?? "");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [member, setMember] = useState<FoundMember | null>(null);
  const [slots, setSlots] = useState<FundableSlot[]>([]);
  const [confirmSlotId, setConfirmSlotId] = useState<string | null>(null);
  const [lastPaidConfirmation, setLastPaidConfirmation] = useState<{
    slotId: string;
    beneficiaryName: string;
    tontineSessionTitle: string;
    amount: number;
  } | null>(null);
  const autoSearchDone = useRef(false);

  async function fetchSlots(memberCode: string) {
    const membershipsRes = await fetch(`/api/members/${encodeURIComponent(memberCode)}/memberships`);
    const membershipsBody = await membershipsRes.json();
    setSlots(membershipsRes.ok ? (membershipsBody.slots ?? []) : []);
  }

  async function findMember(codeToSearch?: string) {
    const trimmed = (codeToSearch ?? code).trim();
    if (!trimmed) return;
    setSearching(true);
    setSearchError(null);
    try {
      const lookupRes = await fetch(`/api/members/lookup-code?code=${encodeURIComponent(trimmed)}`);
      const lookupBody = await lookupRes.json();
      if (!lookupRes.ok) {
        if (lookupBody?.error) console.error("[findMember] server error:", lookupBody.error);
        setSearchError(t("noMemberFoundWithCode"));
        return;
      }
      setMember(lookupBody);
      await fetchSlots(lookupBody.memberCode);
    } catch {
      setSearchError(t("noMemberFoundWithCode"));
    } finally {
      setSearching(false);
    }
  }

  // Auto-search when initialCode is provided (from a shared link)
  useEffect(() => {
    if (initialCode && initialCode.trim() && !autoSearchDone.current) {
      autoSearchDone.current = true;
      findMember(initialCode.trim().toUpperCase());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode]);

  function reset() {
    setMember(null);
    setSlots([]);
    setCode("");
    setSearchError(null);
    setLastPaidConfirmation(null);
  }

  const confirmSlot = slots.find((s) => s.slotId === confirmSlotId);

  // Slots already paid vs unpaid
  const unpaidSlots = slots.filter((s) => !s.alreadyPaid);
  const alreadyPaidSlots = slots.filter((s) => s.alreadyPaid);

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
          onClick={() => findMember()}
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
      {lastPaidConfirmation && (
        <div className="bg-[#ecfdf5] border-2 border-[#10b981] rounded-2xl p-5 shadow-sm flex flex-col gap-3 animate-in fade-in duration-300">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-[#10b981] text-white flex items-center justify-center flex-shrink-0 shadow-xs">
              <span className="material-symbols-outlined text-2xl font-bold">check</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[#d1fae5] text-[#065f46] font-bold text-xs uppercase tracking-wide mb-1">
                <span className="material-symbols-outlined text-[14px]">verified</span>
                {t("checkedPaid")}
              </div>
              <h3 className="font-bold text-base text-[#064e3b]">
                {t("relativePaymentSuccessChecked")}
              </h3>
              <p className="font-body-md text-sm text-[#065f46] mt-0.5">
                {t("relativePaymentSuccessCheckedBody", { name: lastPaidConfirmation.beneficiaryName })}
              </p>
              <div className="mt-3 bg-white/90 rounded-xl p-3 border border-[#a7f3d0] flex flex-wrap items-center justify-between gap-2 text-xs">
                <div>
                  <span className="text-slate-500 font-medium">{t("reasonLabel")} : </span>
                  <span className="font-semibold text-slate-800">{lastPaidConfirmation.tontineSessionTitle}</span>
                </div>
                <div>
                  <span className="text-slate-500 font-medium">{t("amountCotised")} : </span>
                  <span className="font-bold text-[#065f46] font-numeric-data">{formatXAF(lastPaidConfirmation.amount)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

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
          <p className="font-label-md text-label-md text-on-surface truncate font-semibold">{member.name}</p>
        </div>
      </div>

      {member.hasUnpaidFines && (
        <div className="bg-error-container/40 border border-error/30 rounded-xl p-3 flex items-center gap-2">
          <span className="material-symbols-outlined text-error text-[18px]">warning</span>
          <p className="font-label-sm text-label-sm text-on-error-container">
            {t("memberHasUnpaidFines", { amount: formatXAF(member.totalUnpaidFines) })}
          </p>
        </div>
      )}

      <button onClick={reset} className="font-label-sm text-label-sm text-primary underline self-start">
        {t("notThisPerson")}
      </button>

      <div>
        <h2 className="font-label-md text-label-md text-on-surface mb-2">{t("whichContributionToFund")}</h2>
        {unpaidSlots.length === 0 ? (
          <div className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant p-5 text-center">
            <span className="material-symbols-outlined text-emerald-600 text-3xl mb-1">task_alt</span>
            <p className="font-body-md text-body-md text-on-surface font-medium">
              {t("noAvailableContributionsForMember")}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {unpaidSlots.map((s) => (
              <div
                key={s.slotId}
                className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant p-4 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="material-symbols-outlined text-slate-300 text-xl flex-shrink-0" title={t("notCheckedPending")}>
                    radio_button_unchecked
                  </span>
                  <div className="min-w-0">
                    <p className="font-label-md text-label-md text-on-surface truncate font-medium">{s.tontineSessionTitle}</p>
                    <p className="font-label-sm text-label-sm text-on-surface-variant truncate">
                      {s.beneficiaryName} — {formatXAF(s.amount)}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setConfirmSlotId(s.slotId)}
                  className="flex-shrink-0 px-3 py-2 rounded-lg bg-primary text-on-primary font-label-sm text-label-sm hover:opacity-90 active:scale-95 transition-all shadow-xs"
                >
                  {t("payViaFapshi")}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {alreadyPaidSlots.length > 0 && (
        <div className="mt-2">
          <h3 className="font-label-sm text-xs font-semibold uppercase text-emerald-800 tracking-wider mb-2 flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px] text-emerald-600">verified</span>
            {t("checkedPaid")} ({alreadyPaidSlots.length})
          </h3>
          <div className="flex flex-col gap-2">
            {alreadyPaidSlots.map((s) => (
              <div
                key={s.slotId}
                className="bg-[#f0fdf4] rounded-xl border border-emerald-200/80 p-3.5 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="material-symbols-outlined text-emerald-600 text-xl font-bold flex-shrink-0">
                    check_circle
                  </span>
                  <div className="min-w-0">
                    <p className="font-label-md text-label-md text-emerald-950 font-medium truncate">{s.tontineSessionTitle}</p>
                    <p className="font-label-sm text-xs text-emerald-800/80 truncate">
                      {s.beneficiaryName} — {formatXAF(s.amount)}
                    </p>
                  </div>
                </div>
                <span className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#d1fae5] text-[#065f46] text-xs font-semibold">
                  <span className="material-symbols-outlined text-[13px]">check</span>
                  {t("checkedPaid")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {confirmSlot && (
        <PaymentConfirmDialog
          lang={lang}
          membershipSlotId={confirmSlot.slotId}
          payEndpoint={payEndpoint}
          description={`${t("paymentDescriptionPrefix")}: ${confirmSlot.tontineSessionTitle}`}
          onSettled={() => {
            const confirmedSlot = confirmSlot;
            setConfirmSlotId(null);
            if (confirmedSlot) {
              setLastPaidConfirmation({
                slotId: confirmedSlot.slotId,
                beneficiaryName: confirmedSlot.beneficiaryName,
                tontineSessionTitle: confirmedSlot.tontineSessionTitle,
                amount: confirmedSlot.amount,
              });
            }
            fetchSlots(member.memberCode);
          }}
          onClose={() => setConfirmSlotId(null)}
        />
      )}
    </div>
  );
}
