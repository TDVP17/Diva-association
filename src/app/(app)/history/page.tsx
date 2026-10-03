import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getLang, getTranslator } from "@/lib/i18n/get-lang";
import { formatXAF } from "@/lib/format-currency";
import { TONTINE_TYPE_LABELS } from "@/lib/tontine-labels";
import { normalizeCameroonPhone } from "@/lib/fapshi";

interface Row {
  kind: "contribution" | "fine" | "relative_contribution" | "duplicate_refund" | "payout";
  id: string;
  date: Date;
  sessionLabel: string;
  beneficiaryName: string;
  position?: number | null;
  reason: string;
  totalAmount: number;
  pureAmount?: number;
  feeAmount?: number;
  fineAmount?: number;
  status: string;
  payerName?: string | null;
  payerPhone?: string | null;
  txRef?: string | null;
  receiptPdfUrl?: string | null;
  refundReason?: string | null;
}

export default async function HistoryPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const lang = await getLang();
  const t = getTranslator(lang);

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { phone: true, name: true },
  });
  const userPhone = user?.phone ? normalizeCameroonPhone(user.phone) : null;

  const [slots, archives, contributionsForOthers, duplicateAttempts, payouts] = await Promise.all([
    prisma.membershipSlot.findMany({
      where: { membership: { userId: session.user.id } },
      include: {
        contributions: {
          orderBy: { dueDate: "desc" },
          include: { paidByUser: { select: { name: true } } },
        },
        fines: { orderBy: { dueDate: "desc" } },
        membership: { include: { tontineSession: true } },
      },
    }),
    prisma.transactionArchive.findMany({
      where: { userId: session.user.id },
      orderBy: { periodStart: "desc" },
    }),
    prisma.contribution.findMany({
      where: { paidByUserId: session.user.id },
      include: {
        membershipSlot: {
          include: {
            membership: { include: { user: { select: { name: true } }, tontineSession: true } },
          },
        },
      },
      orderBy: { paidAt: "desc" },
    }),
    prisma.paymentAttempt.findMany({
      where: {
        status: { in: ["DUPLICATE_PAID", "REFUND_INITIATED", "REFUNDED", "REFUND_FAILED_MANUAL_REVIEW"] },
        OR: [
          ...(userPhone ? [{ payerPhone: userPhone }] : []),
          { contribution: { membershipSlot: { membership: { userId: session.user.id } } } },
          { fine: { membershipSlot: { membership: { userId: session.user.id } } } },
        ],
      },
      include: {
        contribution: {
          include: {
            membershipSlot: { include: { membership: { include: { tontineSession: true } } } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.payout.findMany({
      where: {
        membershipSlot: { membership: { userId: session.user.id } },
        status: { in: ["RELEASED", "CONFIRMED"] },
      },
      include: {
        membershipSlot: {
          include: {
            membership: { include: { tontineSession: true } },
          },
        },
      },
      orderBy: { releasedAt: "desc" },
    }),
  ]);

  function isArchived(date: Date): boolean {
    return archives.some((a) => date >= a.periodStart && date <= a.periodEnd);
  }

  const rows: Row[] = [];

  // 1. Contributions pour ses propres parts
  for (const slot of slots) {
    const sessionLabel =
      slot.membership.tontineSession.title || TONTINE_TYPE_LABELS[slot.membership.tontineSession.type] || slot.membership.tontineSession.type;
    for (const c of slot.contributions) {
      if (isArchived(c.dueDate)) continue;
      const pureAmount = Number(c.amountPaid);
      const feeAmount = Number(c.feePaid);
      const fineAmount = Number(c.finePaid);
      const totalAmount = pureAmount + feeAmount + fineAmount;
      const effectiveDate = c.paidAt ?? c.dueDate;

      rows.push({
        kind: "contribution",
        id: c.id,
        date: effectiveDate,
        sessionLabel,
        beneficiaryName: slot.beneficiaryName,
        reason: c.paidByUser
          ? `${t("cycleContributionReason")} — ${sessionLabel} (${t("paidByRelativeBadge", { name: c.paidByUser.name })})`
          : `${t("cycleContributionReason")} — ${sessionLabel}`,
        totalAmount,
        pureAmount,
        feeAmount,
        fineAmount: fineAmount > 0 ? fineAmount : undefined,
        status: c.status,
        payerName: c.paidByUser?.name ?? user?.name ?? null,
        payerPhone: c.payerPhone,
        txRef: c.fapshiTxRef,
        receiptPdfUrl: c.status === "PAID" ? c.receiptPdfUrl : null,
      });
    }

    // Amendes de retard
    for (const f of slot.fines) {
      if (isArchived(f.dueDate)) continue;
      rows.push({
        kind: "fine",
        id: f.id,
        date: f.createdAt ?? f.dueDate,
        sessionLabel,
        beneficiaryName: slot.beneficiaryName,
        reason: `${t("fineLabel")} — ${sessionLabel} (${slot.beneficiaryName})`,
        totalAmount: Number(f.amount),
        status: f.status,
        payerName: user?.name ?? null,
        payerPhone: f.payerPhone,
        txRef: f.fapshiTxRef,
        receiptPdfUrl: null,
      });
    }
  }

  // 2. Cotisations payées pour des proches (paymentsMadeForOthers)
  for (const c of contributionsForOthers) {
    // Si c'est déjà listé dans slots (car c'est sa propre part), ne pas dupliquer
    if (slots.some((s) => s.id === c.membershipSlotId)) continue;
    if (isArchived(c.dueDate)) continue;

    const sessionLabel =
      c.membershipSlot.membership.tontineSession.title ||
      TONTINE_TYPE_LABELS[c.membershipSlot.membership.tontineSession.type] ||
      c.membershipSlot.membership.tontineSession.type;
    const pureAmount = Number(c.amountPaid);
    const feeAmount = Number(c.feePaid);
    const fineAmount = Number(c.finePaid);
    const totalAmount = pureAmount + feeAmount + fineAmount;
    const memberName = c.membershipSlot.membership.user.name;

    rows.push({
      kind: "relative_contribution",
      id: c.id,
      date: c.paidAt ?? c.dueDate,
      sessionLabel,
      beneficiaryName: `${c.membershipSlot.beneficiaryName} (${memberName})`,
      reason: `${t("relativeContributionReason")} — ${sessionLabel} (${memberName})`,
      totalAmount,
      pureAmount,
      feeAmount,
      fineAmount: fineAmount > 0 ? fineAmount : undefined,
      status: c.status,
      payerName: user?.name ?? t("youLabel"),
      payerPhone: c.payerPhone,
      txRef: c.fapshiTxRef,
      receiptPdfUrl: c.status === "PAID" ? c.receiptPdfUrl : null,
    });
  }

  // 3. Remboursements automatiques de doublons (problème réseau)
  for (const attempt of duplicateAttempts) {
    const sessionTitle =
      attempt.contribution?.membershipSlot?.membership?.tontineSession?.title ??
      attempt.contribution?.membershipSlot?.membership?.tontineSession?.type ??
      "DIVA Cotisation";
    const slotName = attempt.contribution?.membershipSlot?.beneficiaryName ?? "Cotisation";

    rows.push({
      kind: "duplicate_refund",
      id: attempt.id,
      date: attempt.refundedAt ?? attempt.updatedAt,
      sessionLabel: sessionTitle,
      beneficiaryName: slotName,
      reason: t("duplicateRefundTitle"),
      totalAmount: Number(attempt.amount),
      status: attempt.status,
      payerPhone: attempt.payerPhone,
      txRef: attempt.refundTransId ?? attempt.transId,
      refundReason: attempt.refundReason,
    });
  }

  // 5. Gains de tontine reçus ("bouffes")
  for (const p of payouts) {
    if (isArchived(p.releasedAt ?? p.dueDate)) continue;
    const sessionLabel =
      p.membershipSlot.membership.tontineSession.title ||
      TONTINE_TYPE_LABELS[p.membershipSlot.membership.tontineSession.type] ||
      p.membershipSlot.membership.tontineSession.type;
    const netAmount = Number(p.netPayout ?? Number(p.pot ?? 0) - Number(p.deducted ?? 0));
    const grossPot = Number(p.pot ?? 0);
    const deductedAmount = Number(p.deducted ?? 0);

    rows.push({
      kind: "payout",
      id: p.id,
      date: p.releasedAt ?? p.detailsSubmittedAt,
      sessionLabel,
      beneficiaryName: p.membershipSlot.beneficiaryName,
      position: p.membershipSlot.officialPosition,
      reason:
        lang === "fr"
          ? `Gain de tontine reçu (Bouffe) — ${sessionLabel} (Tour N° ${p.membershipSlot.officialPosition ?? "?"})`
          : `Payout received (Pot turn) — ${sessionLabel} (Turn #${p.membershipSlot.officialPosition ?? "?"})`,
      totalAmount: netAmount,
      pureAmount: grossPot,
      fineAmount: deductedAmount > 0 ? deductedAmount : undefined,
      status: p.status,
      payerName: "DIVA Asso (Cagnotte)",
      payerPhone: p.payoutPhone,
      txRef: p.fapshiTransId,
      receiptPdfUrl: `/api/payouts/${p.id}/receipt`,
    });
  }

  // Trier par date décroissante
  rows.sort((a, b) => b.date.getTime() - a.date.getTime());

  return (
    <main className="px-container-padding py-stack-gap-lg max-w-3xl lg:max-w-4xl mx-auto w-full pb-20">
      <div className="mb-stack-gap-md flex items-center justify-between">
        <div>
          <h1 className="font-title-md text-title-md text-primary">{t("transactionHistory")}</h1>
          <p className="font-body-md text-xs sm:text-sm text-on-surface-variant mt-0.5">
            {lang === "fr"
              ? "Historique détaillé et transparent de toutes vos cotisations, gains de tontine reçus et remboursements."
              : "Detailed and transparent history of all your contributions, payouts received, and refunds."}
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant flex flex-col items-center gap-2">
          <span className="material-symbols-outlined text-outline text-4xl">receipt_long</span>
          <p className="font-body-md text-body-md text-on-surface-variant">{t("noTransactionsYet")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((r) => {
            const isPaid = r.status === "PAID";
            const isRefunded = r.status === "REFUNDED";
            const isRefundPending = r.status === "DUPLICATE_PAID" || r.status === "REFUND_INITIATED";
            const isFailed = r.status === "FAILED" || r.status === "REFUND_FAILED_MANUAL_REVIEW";
            const isPayout = r.kind === "payout";

            return (
              <div
                key={`${r.kind}-${r.id}`}
                className={`bg-white rounded-xl p-4 sm:p-5 shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border transition-all ${
                  isPayout
                    ? "border-emerald-300 bg-gradient-to-br from-emerald-50/40 via-white to-white"
                    : isRefunded || isRefundPending
                      ? "border-cyan-200 bg-cyan-50/20"
                      : isPaid
                        ? "border-surface-variant hover:border-primary/30"
                        : "border-red-200 bg-red-50/10"
                }`}
              >
                {/* Entête de carte avec type, statut et montant */}
                <div className="flex items-start justify-between gap-3 mb-2.5">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    {r.kind === "payout" ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider bg-emerald-700 text-white shadow-xs">
                        <span className="material-symbols-outlined text-[15px]">emoji_events</span>
                        {lang === "fr" ? "Gain de tontine (Bouffe)" : "Payout received"}
                      </span>
                    ) : r.kind === "duplicate_refund" ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider bg-cyan-100 text-cyan-900 border border-cyan-300">
                        <span className="material-symbols-outlined text-[15px]">currency_exchange</span>
                        {t("duplicateRefundTitle")}
                      </span>
                    ) : r.kind === "relative_contribution" ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider bg-indigo-100 text-indigo-900 border border-indigo-200">
                        <span className="material-symbols-outlined text-[15px]">family_restroom</span>
                        {t("relativeContributionReason")}
                      </span>
                    ) : r.kind === "fine" ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider bg-amber-100 text-amber-900 border border-amber-200">
                        <span className="material-symbols-outlined text-[15px]">warning</span>
                        {t("fineLabel")}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider bg-emerald-100 text-emerald-900 border border-emerald-200">
                        <span className="material-symbols-outlined text-[15px]">payments</span>
                        {t("cycleContributionReason")}
                      </span>
                    )}

                    {/* Badge de statut vérifié / coché */}
                    {isPayout ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-[#d1fae5] text-[#065f46]">
                        <span className="material-symbols-outlined text-[14px]">check_circle</span>
                        {r.status === "CONFIRMED"
                          ? lang === "fr"
                            ? "Reçu & Confirmé"
                            : "Confirmed"
                          : lang === "fr"
                            ? "Virement envoyé"
                            : "Sent"}
                      </span>
                    ) : isPaid ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-[#d1fae5] text-[#065f46]">
                        <span className="material-symbols-outlined text-[14px]">check_circle</span>
                        {t("checkedPaid")}
                      </span>
                    ) : null}
                    {isRefunded && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-cyan-100 text-cyan-800">
                        <span className="material-symbols-outlined text-[14px]">check_circle</span>
                        {t("duplicateRefundStatusRefunded")}
                      </span>
                    )}
                    {isRefundPending && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-amber-100 text-amber-800">
                        <span className="material-symbols-outlined text-[14px]">hourglass_top</span>
                        {t("duplicateRefundStatusPending")}
                      </span>
                    )}
                    {isFailed && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-red-100 text-red-800">
                        <span className="material-symbols-outlined text-[14px]">cancel</span>
                        {t("notifStatusFailed")}
                      </span>
                    )}
                  </div>

                  <div className="text-right flex-shrink-0">
                    <div
                      className={`font-numeric-data text-lg sm:text-xl font-extrabold ${
                        isPayout
                          ? "text-emerald-700 font-black"
                          : isRefunded
                            ? "text-cyan-700"
                            : "text-on-surface"
                      }`}
                    >
                      {isPayout || isRefunded ? `+${formatXAF(r.totalAmount)}` : formatXAF(r.totalAmount)}
                    </div>
                  </div>
                </div>

                {/* Raison & Titre */}
                <h3 className="font-label-md text-sm sm:text-base font-bold text-on-surface mb-2">
                  {r.reason}
                </h3>

                {/* Grille de détails avec précision */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-on-surface-variant bg-surface-container-low/50 rounded-lg p-3 border border-surface-variant/60">
                  <div className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-primary">calendar_today</span>
                    <span>
                      <strong className="text-on-surface">{t("dateAndTimeLabel")} :</strong>{" "}
                      {r.date.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-GB", {
                        timeZone: "Africa/Douala",
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}{" "}
                      à{" "}
                      {r.date.toLocaleTimeString(lang === "fr" ? "fr-FR" : "en-GB", {
                        timeZone: "Africa/Douala",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-primary">person</span>
                    <span>
                      <strong className="text-on-surface">{t("beneficiaryName")} :</strong> {r.beneficiaryName}
                    </span>
                  </div>

                  {/* Détails spécifiques pour les gains de tontine */}
                  {r.kind === "payout" && (
                    <div className="flex items-center gap-1.5 sm:col-span-2 text-emerald-950 font-semibold bg-emerald-50/80 p-2 rounded-lg border border-emerald-200">
                      <span className="material-symbols-outlined text-[16px] text-emerald-700">stars</span>
                      <span>
                        {r.position ? (lang === "fr" ? `Position : Tour N° ${r.position}` : `Position: Turn #${r.position}`) : ""}
                        {r.pureAmount !== undefined && r.pureAmount !== r.totalAmount && (
                          <span className="ml-2 font-normal text-emerald-800 text-xs">
                            (Cagnotte : {formatXAF(r.pureAmount)}{r.fineAmount ? ` · Déductions : -${formatXAF(r.fineAmount)}` : ""})
                          </span>
                        )}
                      </span>
                    </div>
                  )}

                  {/* Décomposition du montant cotisé */}
                  {(r.pureAmount !== undefined && r.feeAmount !== undefined) && (
                    <div className="flex items-center gap-1.5 sm:col-span-2">
                      <span className="material-symbols-outlined text-[16px] text-primary">account_balance_wallet</span>
                      <span>
                        <strong className="text-on-surface">{t("amountCotised")} :</strong>{" "}
                        {t("pureContributionAmount")} : {formatXAF(r.pureAmount)} + {t("feeAmountLabel")} : {formatXAF(r.feeAmount)}
                        {r.fineAmount ? ` + ${t("fineDetailLabel")} : ${formatXAF(r.fineAmount)}` : ""}
                      </span>
                    </div>
                  )}

                  {/* Téléphone et Payeur */}
                  {r.payerPhone && (
                    <div className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[16px] text-primary">smartphone</span>
                      <span>
                        <strong className="text-on-surface">{t("payerPhoneLabel")} :</strong> {r.payerPhone}
                      </span>
                    </div>
                  )}

                  {/* Référence de transaction */}
                  {r.txRef && (
                    <div className="flex items-center gap-1.5 font-mono text-[11px] truncate">
                      <span className="material-symbols-outlined text-[16px] text-primary">tag</span>
                      <span>
                        <strong className="text-on-surface">{t("transactionRefLabel")} :</strong> {r.txRef}
                      </span>
                    </div>
                  )}
                </div>

                {/* Note ou explication du remboursement de doublon */}
                {r.refundReason && (
                  <p className="mt-2 text-xs text-cyan-900 bg-cyan-100/70 p-2 rounded-md border border-cyan-200 flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px]">info</span>
                    <span>{r.refundReason}</span>
                  </p>
                )}

                {/* Téléchargement de reçu si disponible */}
                {r.receiptPdfUrl && (
                  <div className="mt-3 pt-2.5 border-t border-surface-variant flex items-center justify-end">
                    <a
                      href={r.receiptPdfUrl.startsWith("/") ? r.receiptPdfUrl : `/api/files/${r.receiptPdfUrl}`}
                      target="_blank"
                      rel="noreferrer"
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-xs font-semibold shadow-xs transition-colors ${
                        r.kind === "payout"
                          ? "bg-emerald-700 hover:bg-emerald-800"
                          : "bg-primary hover:bg-primary/90"
                      }`}
                    >
                      <span className="material-symbols-outlined text-[16px]">picture_as_pdf</span>
                      {r.kind === "payout"
                        ? (lang === "fr" ? "Télécharger le reçu de gain (PDF)" : "Download Payout Receipt (PDF)")
                        : t("downloadReceiptPdf")}
                    </a>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {archives.length > 0 && (
        <section className="mt-section-margin">
          <h2 className="font-title-sm text-title-sm text-primary mb-stack-gap-md">{t("archivedHistoryTitle")}</h2>
          <div className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant overflow-hidden">
            {archives.map((a, i) => (
              <div
                key={a.id}
                className={`flex items-center justify-between gap-2 px-4 py-3 ${i < archives.length - 1 ? "border-b border-surface-variant" : ""}`}
              >
                <span className="font-label-md text-label-md text-on-surface">
                  {a.periodStart.getUTCFullYear()}
                </span>
                <a
                  href={`/api/files/${a.pdfUrl}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 font-label-sm text-label-sm text-primary underline"
                >
                  <span className="material-symbols-outlined text-[18px]">download</span>
                  {t("downloadReceiptPdf")}
                </a>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
