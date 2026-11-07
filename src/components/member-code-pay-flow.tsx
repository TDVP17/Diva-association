"use client";

import { useEffect, useState, useRef } from "react";
import { translate, type Lang } from "@/lib/i18n/translations";
import { PaymentConfirmDialog } from "@/components/payment-confirm-dialog";
import { BulkPaymentDialog } from "@/app/(app)/global-payment/bulk-payment-dialog";
import { formatXAF } from "@/lib/format-currency";
import { getSupabaseAccessToken, getSupabaseBrowserClient } from "@/lib/supabase/client";

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
  receiptUrl?: string | null;
}

/**
 * Enter a member's personal code → see every active cotisation cycle they
 * still owe → pay one via Fapshi. Shared by the authenticated "Contribute
 * for a Relative" page and the /pay entry point (shared link) — both call
 * the `relative` action of the `fapshi-pay` Supabase Edge Function, which
 * records the signed-in payer as paidByUserId.
 *
 * When an `initialCode` is provided (e.g. from a shared link), the flow
 * auto-searches on mount so the payer sees the member's unpaid cotisations
 * immediately without needing to type anything.
 */
export function MemberCodePayFlow({
  lang,
  initialCode,
  currentUser,
}: {
  lang: Lang;
  initialCode?: string;
  currentUser?: { id: string; name?: string | null; email?: string | null } | null;
}) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);

  const [code, setCode] = useState(initialCode?.trim().toUpperCase() ?? "");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [member, setMember] = useState<FoundMember | null>(null);
  const [slots, setSlots] = useState<FundableSlot[]>([]);
  const [selectedSlotIds, setSelectedSlotIds] = useState<string[]>([]);
  const [showBulkDialog, setShowBulkDialog] = useState(false);
  const [showAuthRequiredModal, setShowAuthRequiredModal] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [lastPaidConfirmation, setLastPaidConfirmation] = useState<{
    slotId: string;
    beneficiaryName: string;
    tontineSessionTitle: string;
    amount: number;
    receiptUrl?: string | null;
  } | null>(null);
  const autoSearchDone = useRef(false);

  async function fetchSlots(memberCode: string) {
    const membershipsRes = await fetch(`/api/members/${encodeURIComponent(memberCode)}/memberships`);
    if (membershipsRes.status === 401) {
      setShowAuthRequiredModal(true);
      return [];
    }
    const membershipsBody = await membershipsRes.json();
    const fetchedSlots: FundableSlot[] = membershipsRes.ok ? (membershipsBody.slots ?? []) : [];
    setSlots(fetchedSlots);
    const unpaid = fetchedSlots.filter((s) => !s.alreadyPaid);
    setSelectedSlotIds(unpaid.map((s) => s.slotId));
    return fetchedSlots;
  }

  async function findMember(codeToSearch?: string) {
    const trimmed = (codeToSearch ?? code).trim();
    if (!trimmed) return;
    if (!currentUser) {
      setShowAuthRequiredModal(true);
      return;
    }
    setSearching(true);
    setSearchError(null);
    try {
      const lookupRes = await fetch(`/api/members/lookup-code?code=${encodeURIComponent(trimmed)}`);
      if (lookupRes.status === 401) {
        setShowAuthRequiredModal(true);
        return;
      }
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
    setSelectedSlotIds([]);
    setShowBulkDialog(false);
    setCode("");
    setSearchError(null);
    setLastPaidConfirmation(null);
  }

  const [confirmSlotId, setConfirmSlotId] = useState<string | null>(null);
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

              {/* Action buttons: Download receipt now / Share WhatsApp / View history */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {lastPaidConfirmation.receiptUrl ? (
                  <a
                    href={lastPaidConfirmation.receiptUrl.startsWith("/") ? lastPaidConfirmation.receiptUrl : `/api/files/${lastPaidConfirmation.receiptUrl}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#065f46] hover:bg-[#064e3b] text-white font-bold text-xs transition-all shadow-xs cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[16px]">download</span>
                    <span>{lang === "fr" ? "Télécharger le reçu maintenant" : "Download receipt now"}</span>
                  </a>
                ) : (
                  <a
                    href="/history"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#065f46] hover:bg-[#064e3b] text-white font-bold text-xs transition-all shadow-xs cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[16px]">download</span>
                    <span>{lang === "fr" ? "Reçu disponible dans l'historique" : "Receipt in history"}</span>
                  </a>
                )}

                <button
                  type="button"
                  onClick={() => {
                    const fullUrl = lastPaidConfirmation.receiptUrl
                      ? (lastPaidConfirmation.receiptUrl.startsWith("http")
                          ? lastPaidConfirmation.receiptUrl
                          : `${typeof window !== "undefined" ? window.location.origin : ""}${lastPaidConfirmation.receiptUrl.startsWith("/") ? lastPaidConfirmation.receiptUrl : `/api/files/${lastPaidConfirmation.receiptUrl}`}`)
                      : `${typeof window !== "undefined" ? window.location.origin : ""}/history`;
                    const text = lang === "fr"
                      ? `Bonjour, j'ai effectué le paiement de la cotisation pour *${lastPaidConfirmation.beneficiaryName}* (${lastPaidConfirmation.tontineSessionTitle}) d'un montant de *${formatXAF(lastPaidConfirmation.amount)}*. Reçu disponible ici : ${fullUrl}`
                      : `Hello, I made the contribution payment for *${lastPaidConfirmation.beneficiaryName}* (${lastPaidConfirmation.tontineSessionTitle}) for an amount of *${formatXAF(lastPaidConfirmation.amount)}*. Receipt available here: ${fullUrl}`;
                    const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
                    window.open(waUrl, "_blank", "noopener,noreferrer");
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#25D366] hover:bg-[#128C7E] text-white font-bold text-xs transition-all shadow-xs cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[16px]">share</span>
                  <span>{t("shareReceiptWhatsApp")}</span>
                </button>

                <a
                  href="/history"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-[#a7f3d0] text-[#065f46] font-semibold text-xs hover:bg-[#f0fdf4] transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[16px]">receipt_long</span>
                  <span>{lang === "fr" ? "Voir dans mes historiques" : "View in my history"}</span>
                </a>
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
            {unpaidSlots.length > 1 && (
              <div className="flex items-center justify-between gap-2 px-1 mb-1">
                <button
                  type="button"
                  onClick={() => {
                    if (selectedSlotIds.length === unpaidSlots.length) {
                      setSelectedSlotIds([]);
                    } else {
                      setSelectedSlotIds(unpaidSlots.map((s) => s.slotId));
                    }
                  }}
                  className="text-xs font-semibold text-primary hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[16px]">
                    {selectedSlotIds.length === unpaidSlots.length ? "check_box" : "check_box_outline_blank"}
                  </span>
                  <span>
                    {selectedSlotIds.length === unpaidSlots.length ? t("deselectAllNames") : t("selectAllNames")}
                  </span>
                </button>
                <span className="text-xs text-on-surface-variant font-medium">
                  {selectedSlotIds.length}/{unpaidSlots.length} {lang === "fr" ? "sélectionné(s)" : "selected"}
                </span>
              </div>
            )}

            {!currentUser && (
              <div className="mb-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-amber-700 flex-shrink-0">info</span>
                <span>
                  {lang === "fr"
                    ? "Une connexion en 1 clic (Google ou Email) vous sera demandée pour valider votre cotisation et recevoir votre reçu officiel."
                    : "A 1-click sign-in (Google or Email) is required to complete your contribution and receive your official receipt."}
                </span>
              </div>
            )}

            {selectedSlotIds.length > 1 && (
              <button
                type="button"
                onClick={async () => {
                  const token = currentUser ? await getSupabaseAccessToken() : null;
                  if (!currentUser || !token) {
                    setShowAuthRequiredModal(true);
                  } else {
                    setShowBulkDialog(true);
                  }
                }}
                className="w-full mb-2 py-3 px-4 rounded-xl bg-primary hover:bg-primary/95 text-on-primary font-bold text-sm flex items-center justify-center gap-2 shadow-sm transition-transform active:scale-[0.99] cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">payments</span>
                <span>{t("globalPaymentForRelative", { count: String(selectedSlotIds.length) })}</span>
              </button>
            )}

            {unpaidSlots.map((s) => {
              const isSelected = selectedSlotIds.includes(s.slotId);
              return (
                <div
                  key={s.slotId}
                  className={`bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border p-4 flex items-center justify-between gap-3 transition-colors ${
                    isSelected ? "border-primary/50 bg-primary/5" : "border-surface-variant"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {unpaidSlots.length > 1 && (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {
                          setSelectedSlotIds((prev) =>
                            prev.includes(s.slotId) ? prev.filter((id) => id !== s.slotId) : [...prev, s.slotId],
                          );
                        }}
                        className="w-4 h-4 rounded text-primary focus:ring-primary/30 cursor-pointer flex-shrink-0"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="font-label-md text-label-md text-on-surface truncate font-semibold">{s.beneficiaryName}</p>
                      <p className="font-label-sm text-label-sm text-on-surface-variant truncate">
                        {s.tontineSessionTitle} — <span className="font-semibold text-emerald-800">{formatXAF(s.amount)}</span>
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      const token = currentUser ? await getSupabaseAccessToken() : null;
                      if (!currentUser || !token) {
                        setShowAuthRequiredModal(true);
                      } else {
                        setConfirmSlotId(s.slotId);
                      }
                    }}
                    className="flex-shrink-0 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-label-sm text-label-sm font-semibold hover:opacity-90 active:scale-95 transition-all shadow-xs cursor-pointer"
                  >
                    {t("payViaFapshi")}
                  </button>
                </div>
              );
            })}
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
                {s.receiptUrl ? (
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <a
                      href={s.receiptUrl.startsWith("/") ? s.receiptUrl : `/api/files/${s.receiptUrl}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-800 text-xs font-bold transition-colors shadow-2xs cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[14px]">download</span>
                      <span>{lang === "fr" ? "Reçu" : "Receipt"}</span>
                    </a>
                    <a
                      href={`https://api.whatsapp.com/send?text=${encodeURIComponent(
                        lang === "fr"
                          ? `Bonjour, voici le reçu de cotisation pour ${s.beneficiaryName} (${s.tontineSessionTitle}) : ${s.receiptUrl.startsWith("http") ? s.receiptUrl : `${typeof window !== "undefined" ? window.location.origin : ""}${s.receiptUrl.startsWith("/") ? s.receiptUrl : `/api/files/${s.receiptUrl}`}`}`
                          : `Hello, here is the contribution receipt for ${s.beneficiaryName} (${s.tontineSessionTitle}): ${s.receiptUrl.startsWith("http") ? s.receiptUrl : `${typeof window !== "undefined" ? window.location.origin : ""}${s.receiptUrl.startsWith("/") ? s.receiptUrl : `/api/files/${s.receiptUrl}`}`}`,
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#25D366] hover:bg-[#128C7E] text-white text-xs font-semibold shadow-2xs cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[14px]">share</span>
                      <span>WhatsApp</span>
                    </a>
                  </div>
                ) : (
                  <span className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#d1fae5] text-[#065f46] text-xs font-semibold">
                    <span className="material-symbols-outlined text-[13px]">check</span>
                    {t("checkedPaid")}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {confirmSlot && (
        <PaymentConfirmDialog
          lang={lang}
          membershipSlotId={confirmSlot.slotId}
          beneficiaryName={confirmSlot.beneficiaryName}
          fallbackAvailableSlots={unpaidSlots.map((s) => ({
            id: s.slotId,
            beneficiaryName: `${s.beneficiaryName} (${s.tontineSessionTitle})`,
            baseTotal: s.amount,
          }))}
          payAction="relative"
          description={`${t("paymentDescriptionPrefix")}: ${confirmSlot.tontineSessionTitle}`}
          onSettled={async () => {
            const confirmedSlot = confirmSlot;
            setConfirmSlotId(null);
            const freshSlots = await fetchSlots(member.memberCode);
            const updatedSlot = freshSlots.find((s) => s.slotId === confirmedSlot?.slotId);
            if (confirmedSlot) {
              setLastPaidConfirmation({
                slotId: confirmedSlot.slotId,
                beneficiaryName: confirmedSlot.beneficiaryName,
                tontineSessionTitle: confirmedSlot.tontineSessionTitle,
                amount: confirmedSlot.amount,
                receiptUrl: updatedSlot?.receiptUrl ?? null,
              });
            }
          }}
          onProofSubmitted={async () => {
            setConfirmSlotId(null);
            await fetchSlots(member.memberCode);
          }}
          onClose={() => setConfirmSlotId(null)}
        />
      )}

      {showBulkDialog && selectedSlotIds.length > 0 && (
        <BulkPaymentDialog
          lang={lang}
          membershipSlotIds={selectedSlotIds}
          isRelative={true}
          onSettled={async () => {
            setShowBulkDialog(false);
            const count = selectedSlotIds.length;
            const paidSlots = unpaidSlots.filter((s) => selectedSlotIds.includes(s.slotId));
            const totalPaid = paidSlots.reduce((acc, s) => acc + s.amount, 0);
            setSelectedSlotIds([]);
            const freshSlots = await fetchSlots(member.memberCode);
            setLastPaidConfirmation({
              slotId: "bulk",
              beneficiaryName: `${count} ${lang === "fr" ? "noms sélectionnés" : "selected names"}`,
              tontineSessionTitle: member.name,
              amount: totalPaid,
              receiptUrl: freshSlots.find((s) => s.alreadyPaid)?.receiptUrl ?? null,
            });
          }}
          onProofSubmitted={async () => {
            setShowBulkDialog(false);
            await fetchSlots(member.memberCode);
          }}
          onClose={() => setShowBulkDialog(false)}
        />
      )}

      {showAuthRequiredModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl border border-emerald-900/10 max-w-sm w-full p-6 flex flex-col gap-5 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 flex items-center justify-center mx-auto shadow-xs">
              <span className="material-symbols-outlined text-3xl">login</span>
            </div>

            <div>
              <h3 className="font-bold text-lg text-slate-900">
                {lang === "fr" ? "Connexion requise pour cotiser" : "Sign-in required to contribute"}
              </h3>
              <p className="text-sm text-slate-600 mt-2 leading-relaxed">
                {lang === "fr"
                  ? `Pour cotiser pour ${member.name}, connectez-vous ou créez votre compte DIVA Asso. Votre reçu officiel sera enregistré dans votre historique et vous recevrez votre confirmation par email.`
                  : `To contribute for ${member.name}, please sign in or create your DIVA Asso account. Your official receipt will be saved in your history and sent via email.`}
              </p>
            </div>

            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                disabled={googleLoading}
                onClick={async () => {
                  setGoogleLoading(true);
                  try {
                    const supabase = getSupabaseBrowserClient();
                    const currentPath = typeof window !== "undefined"
                      ? `${window.location.pathname}${window.location.search}`
                      : `/pay?code=${member.memberCode}`;
                    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(currentPath)}`;
                    if (supabase) {
                      const { error } = await supabase.auth.signInWithOAuth({
                        provider: "google",
                        options: { redirectTo },
                      });
                      if (error) {
                        window.location.href = `/login?callbackUrl=${encodeURIComponent(currentPath)}`;
                      }
                    } else {
                      window.location.href = `/login?callbackUrl=${encodeURIComponent(currentPath)}`;
                    }
                  } catch {
                    const currentPath = typeof window !== "undefined"
                      ? `${window.location.pathname}${window.location.search}`
                      : `/pay?code=${member.memberCode}`;
                    window.location.href = `/login?callbackUrl=${encodeURIComponent(currentPath)}`;
                  }
                }}
                className="w-full py-3 px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-semibold text-sm flex items-center justify-center gap-2.5 shadow-xs transition-colors cursor-pointer"
              >
                <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                <span>{googleLoading ? (lang === "fr" ? "Connexion..." : "Connecting...") : (lang === "fr" ? "Continuer avec Google" : "Continue with Google")}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const target = typeof window !== "undefined"
                    ? `${window.location.pathname}${window.location.search}`
                    : `/pay?code=${member.memberCode}`;
                  window.location.href = `/login?callbackUrl=${encodeURIComponent(target)}&authRequired=1`;
                }}
                className="w-full py-2.5 px-4 rounded-xl bg-primary hover:bg-primary/95 text-on-primary font-semibold text-sm transition-colors cursor-pointer"
              >
                {lang === "fr" ? "Se connecter par Email" : "Sign in with Email"}
              </button>

              <button
                type="button"
                onClick={() => {
                  const target = typeof window !== "undefined"
                    ? `${window.location.pathname}${window.location.search}`
                    : `/pay?code=${member.memberCode}`;
                  window.location.href = `/login?mode=signup&callbackUrl=${encodeURIComponent(target)}&authRequired=1`;
                }}
                className="w-full py-2.5 px-4 rounded-xl border-2 border-primary text-primary hover:bg-primary/5 font-semibold text-sm transition-colors cursor-pointer"
              >
                {lang === "fr" ? "Créer un compte (S'inscrire)" : "Create an account (Sign up)"}
              </button>

              <button
                type="button"
                onClick={() => setShowAuthRequiredModal(false)}
                className="text-xs text-slate-500 hover:text-slate-700 py-1 cursor-pointer"
              >
                {lang === "fr" ? "Annuler" : "Cancel"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
