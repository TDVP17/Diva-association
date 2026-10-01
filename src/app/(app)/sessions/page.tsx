import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { assertJoinable, sumRegisteredSlots } from "@/lib/session-joinability";
import { getLang, getTranslator } from "@/lib/i18n/get-lang";
import { getTontineConfig } from "@/lib/tontine-engine";
import { HideClosedSessionButton } from "./hide-closed-session-button";
import { formatXAF } from "@/lib/format-currency";
import { sessionStatusKey } from "@/lib/session-status-label";

const TONTINE_LABELS: Record<string, string> = {
  HEBDO_SUNDAY: "Weekly Tontine (Sunday)",
  MONTHLY_28: "Monthly Tontine (28th)",
  MONTHLY_25: "Monthly Tontine (25th)",
  BIWEEKLY_SUNDAY: "Every 2 Weeks (Sunday)",
  QUARTERLY_25: "Every 3 Months (25th)",
};

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-surface-container-high text-on-surface-variant",
  DRAWING: "bg-secondary-fixed-dim/20 text-on-secondary-fixed-variant",
  ACTIVE: "bg-primary/10 text-primary",
  CLOSED: "bg-surface-container-high text-on-surface-variant",
};

export default async function SessionsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const userId = session.user.id;
  const lang = await getLang();
  const t = getTranslator(lang);

  const memberships = await prisma.membership.findMany({
    where: { userId, hiddenByMemberAt: null },
    include: { tontineSession: true, slots: true },
    orderBy: { joinedAt: "desc" },
  });

  const excludedSessionIds = memberships
    .filter((m) => m.status === "APPROVED" || m.status === "PENDING" || m.status === "BANNED")
    .map((m) => m.tontineSessionId);

  const candidates = await prisma.tontineSession.findMany({
    where: {
      status: { not: "CLOSED" },
      id: { notIn: excludedSessionIds },
    },
    include: { memberships: { select: { status: true, slotCount: true } } },
    orderBy: { startDate: "asc" },
  });
  const browsable = candidates.filter(
    (s) =>
      assertJoinable(
        { ...s, maxSlots: s.maxSlots ? Number(s.maxSlots) : null },
        sumRegisteredSlots(s.memberships),
      ).ok,
  );
  const nonJoinable = candidates.filter(
    (s) =>
      !assertJoinable(
        { ...s, maxSlots: s.maxSlots ? Number(s.maxSlots) : null },
        sumRegisteredSlots(s.memberships),
      ).ok,
  );

  const activeCotisationsList = nonJoinable.map((s) => {
    const regSlots = sumRegisteredSlots(s.memberships);
    const isFull = s.maxSlots !== null && regSlots >= Number(s.maxSlots);
    const approvedDbCount = s.memberships.filter((m) => m.status === "APPROVED").length;
    const membersCount = approvedDbCount > 0 ? approvedDbCount : (s.validatedMembersCount ?? 0);
    return {
      id: s.id,
      title: s.title || TONTINE_LABELS[s.type] || s.type,
      description: s.description,
      startDate: s.startDate,
      membersCount,
      amount: Number(s.amount),
      fee: Number(s.fee),
      isFull,
      isActive: s.status === "ACTIVE",
      type: s.type,
      limitTime: s.limitTime,
      fineAmountPerPeriod: s.fineAmountPerPeriod ? Number(s.fineAmountPerPeriod) : null,
      fineIntervalHours: s.fineIntervalHours,
    };
  });

  return (
    <main className="px-container-padding py-stack-gap-lg max-w-3xl lg:max-w-6xl mx-auto w-full flex flex-col gap-section-margin">
      <section>
        <div className="sticky top-16 z-30 bg-background py-2 -mx-container-padding px-container-padding mb-stack-gap-md shadow-[0px_4px_20px_rgba(30,41,59,0.05)] flex items-center justify-between gap-2">
          <h2 className="font-title-md text-title-md text-primary">{t("mySessions")}</h2>
          {memberships.length > 0 && (
            <Link
              href="/global-payment"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary font-label-sm text-label-sm hover:bg-primary/20 transition-colors flex-shrink-0"
            >
              <span className="material-symbols-outlined text-[16px]">account_balance_wallet</span>
              {t("globalPaymentNavLabel")}
            </Link>
          )}
        </div>
        {memberships.length === 0 ? (
          <div className="bg-white rounded-xl p-8 text-center shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant flex flex-col items-center gap-stack-gap-sm">
            <span className="material-symbols-outlined text-outline text-[40px]">group_add</span>
            <p className="font-body-md text-body-md text-on-surface-variant">{t("notJoinedYet")}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-stack-gap-md lg:grid lg:grid-cols-2 xl:grid-cols-3 lg:gap-stack-gap-md">
            {memberships.map((m) => (
              <div
                key={m.id}
                className="relative bg-white rounded-xl p-4 shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant flex items-center justify-between hover:bg-surface-container-low transition-colors"
              >
                <Link href={`/sessions/${m.tontineSession.id}`} className="absolute inset-0 rounded-xl" />
                <div className="pointer-events-none">
                  <h3 className="font-label-md text-label-md text-on-surface">
                    {m.tontineSession.title || TONTINE_LABELS[m.tontineSession.type]}
                  </h3>
                  {m.tontineSession.description && (
                    <details className="my-1 max-w-md pointer-events-auto relative z-10" onClick={(e) => e.stopPropagation()}>
                      <summary
                        className="cursor-pointer inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200/80 font-medium text-[11px] hover:bg-emerald-100 transition-colors shadow-2xs list-none [&::-webkit-details-marker]:hidden"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="text-[12px]">✨</span>
                        <span>{t("seeDescription")}</span>
                      </summary>
                      <p className="font-body-sm text-xs text-on-surface-variant/80 line-clamp-3 mt-1.5 bg-surface-container-low/70 p-2.5 rounded-lg border border-surface-variant/60 leading-relaxed">
                        {m.tontineSession.description}
                      </p>
                    </details>
                  )}
                  <p className="font-label-sm text-label-sm text-on-surface-variant">
                    {m.status === "APPROVED"
                      ? m.slotCount === null
                        ? t("selectSlotsToStart")
                        : `${m.slots.length} ${t("slotsRegistered")}`
                      : m.status === "PENDING"
                        ? t("awaitingApproval")
                        : m.status === "BANNED"
                          ? (lang === "fr" ? "Accès banni" : "Access banned")
                          : (lang === "fr" ? "Demande refusée (cliquez pour redemander)" : "Rejected (tap to re-apply)")}
                  </p>
                  {(() => {
                    const fallback = getTontineConfig(m.tontineSession.type);
                    const fAmount = m.tontineSession.fineAmountPerPeriod
                      ? Number(m.tontineSession.fineAmountPerPeriod)
                      : (fallback?.fineAmountPerPeriod ?? 500);
                    const fInterval = m.tontineSession.fineIntervalHours ?? fallback?.fineIntervalHours ?? 24;
                    const lTime = m.tontineSession.limitTime || "18:30";
                    return (
                      <details
                        className="mt-1 max-w-md pointer-events-auto relative z-10"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <summary
                          className="cursor-pointer font-label-sm text-[11px] text-amber-700 flex items-center gap-1 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="material-symbols-outlined text-[13px]">gavel</span>
                          {lang === "fr" ? "Règles des amendes" : "Fine rules"} ({formatXAF(fAmount)})
                        </summary>
                        <p className="font-body-sm text-[11px] text-on-surface-variant/90 mt-1 bg-amber-50/70 p-2 rounded border border-amber-200/60 leading-relaxed">
                          {lang === "fr"
                            ? `Amende de ${formatXAF(fAmount)} après ${lTime}, puis toutes les ${fInterval}h si le paiement n'est pas fait.`
                            : `Fine of ${formatXAF(fAmount)} after ${lTime}, then every ${fInterval}h if unpaid.`}
                        </p>
                      </details>
                    );
                  })()}
                </div>
                <div className="relative z-10 flex items-center gap-1 flex-shrink-0">
                  <span
                    className={`font-label-sm text-label-sm px-2 py-1 rounded pointer-events-none ${STATUS_STYLES[m.tontineSession.status]}`}
                  >
                    {t(sessionStatusKey(m.tontineSession.status))}
                  </span>
                  {m.tontineSession.status === "CLOSED" && (
                    <HideClosedSessionButton membershipId={m.id} lang={lang} />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="font-title-md text-title-md text-primary mb-stack-gap-md">{t("openCotisations")}</h2>
        {browsable.length === 0 ? (
          <div className="bg-white rounded-xl p-8 text-center shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant flex flex-col items-center gap-stack-gap-sm">
            <span className="material-symbols-outlined text-outline text-[40px]">event_busy</span>
            <p className="font-body-md text-body-md text-on-surface-variant">{t("noOpenCotisations")}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-stack-gap-md lg:grid lg:grid-cols-2 xl:grid-cols-3 lg:gap-stack-gap-md">
            {browsable.map((s) => (
              <Link
                key={s.id}
                href={`/sessions/${s.id}`}
                className="bg-white rounded-xl p-4 shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant flex items-center justify-between hover:bg-surface-container-low transition-colors"
              >
                <div>
                  <h3 className="font-label-md text-label-md text-on-surface">
                    {s.title || TONTINE_LABELS[s.type]}
                  </h3>
                  {s.description && (
                    <details className="my-1 max-w-md relative z-10" onClick={(e) => e.stopPropagation()}>
                      <summary
                        className="cursor-pointer inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200/80 font-medium text-[11px] hover:bg-emerald-100 transition-colors shadow-2xs list-none [&::-webkit-details-marker]:hidden"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="text-[12px]">✨</span>
                        <span>{t("seeDescription")}</span>
                      </summary>
                      <p className="font-body-sm text-xs text-on-surface-variant/80 line-clamp-3 mt-1.5 bg-surface-container-low/70 p-2.5 rounded-lg border border-surface-variant/60 leading-relaxed">
                        {s.description}
                      </p>
                    </details>
                  )}
                  <p className="font-label-sm text-label-sm text-on-surface-variant">
                    {t("startsOn")} {s.startDate.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                  {(() => {
                    const approvedDbCount = s.memberships.filter((m) => m.status === "APPROVED").length;
                    const membersCount = approvedDbCount > 0 ? approvedDbCount : (s.validatedMembersCount ?? 0);
                    const count = membersCount || (s.maxSlots ? Number(s.maxSlots) : 1);
                    const pot = Math.round(count * Number(s.amount) + count * Number(s.fee) * 0.25);
                    return (
                      <>
                        {membersCount > 0 && (
                          <p className="font-label-sm text-label-sm text-primary mt-0.5">
                            {t("validatedMembersCount", {
                              count: String(membersCount),
                            })}
                          </p>
                        )}
                        <p className="font-label-sm text-label-sm text-on-surface-variant mt-1 flex items-center gap-1 flex-wrap">
                          <span className="font-numeric-data text-on-surface font-semibold">{formatXAF(Number(s.amount))}</span>
                          <span>{t("plusFeeSuffix", { fee: formatXAF(Number(s.fee)) })}</span>
                        </p>
                        <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-50 border border-slate-200 text-slate-600 text-[11px] font-medium">
                          <span className="material-symbols-outlined text-[15px] text-primary">info</span>
                          <span>{lang === "fr" ? "Le montant total dépend du nombre de membres (visible après validation)" : "Total pot depends on member count (visible once validated)"}</span>
                        </div>
                        {(() => {
                          const fallback = getTontineConfig(s.type);
                          const fAmount = s.fineAmountPerPeriod
                            ? Number(s.fineAmountPerPeriod)
                            : (fallback?.fineAmountPerPeriod ?? 500);
                          const fInterval = s.fineIntervalHours ?? fallback?.fineIntervalHours ?? 24;
                          const lTime = s.limitTime || "18:30";
                          return (
                            <details
                              className="mt-2 max-w-md relative z-10"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <summary
                                className="cursor-pointer font-label-sm text-[11px] text-amber-700 flex items-center gap-1 hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <span className="material-symbols-outlined text-[13px]">gavel</span>
                                {lang === "fr" ? "Règles des amendes" : "Fine rules"} ({formatXAF(fAmount)})
                              </summary>
                              <p className="font-body-sm text-[11px] text-on-surface-variant/90 mt-1 bg-amber-50/70 p-2 rounded border border-amber-200/60 leading-relaxed">
                                {lang === "fr"
                                  ? `Amende de ${formatXAF(fAmount)} après ${lTime}, puis toutes les ${fInterval}h si le paiement n'est pas fait.`
                                  : `Fine of ${formatXAF(fAmount)} after ${lTime}, then every ${fInterval}h if unpaid.`}
                              </p>
                            </details>
                          );
                        })()}
                      </>
                    );
                  })()}
                </div>
                <span className="material-symbols-outlined text-outline">chevron_right</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="font-title-md text-title-md text-primary mb-stack-gap-md">{t("activeCotisations")}</h2>
        {activeCotisationsList.length === 0 ? (
          <div className="bg-white rounded-xl p-8 border border-surface-variant text-center">
            <p className="font-label-sm text-label-sm text-on-surface-variant">
              {t("noActiveCotisations")}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-stack-gap-md lg:grid lg:grid-cols-2 xl:grid-cols-3 lg:gap-stack-gap-md">
            {activeCotisationsList.map((c) => (
              <Link key={c.id} href={`/sessions/${c.id}`} className="block h-full">
                <div className="bg-white rounded-xl p-4 shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant flex items-center justify-between hover:bg-surface-container-low transition-colors h-full">
                  <div>
                    <h3 className="font-label-md text-label-md text-on-surface font-medium">
                      {c.title}
                    </h3>
                    {c.description && (
                      <details className="my-1 max-w-md relative z-10" onClick={(e) => e.stopPropagation()}>
                        <summary
                          className="cursor-pointer inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200/80 font-medium text-[11px] hover:bg-emerald-100 transition-colors shadow-2xs list-none [&::-webkit-details-marker]:hidden"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="text-[12px]">✨</span>
                          <span>{t("seeDescription")}</span>
                        </summary>
                        <p className="font-body-sm text-xs text-on-surface-variant/80 line-clamp-3 mt-1.5 bg-surface-container-low/70 p-2.5 rounded-lg border border-surface-variant/60 leading-relaxed">
                          {c.description}
                        </p>
                      </details>
                    )}
                    <p className="font-label-sm text-label-sm text-on-surface-variant">
                      {t("startsOn")}{" "}
                      {c.startDate.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </p>
                    <p className="font-label-sm text-label-sm text-primary mt-0.5">
                      {t("validatedMembersCount", { count: String(c.membersCount) })}
                    </p>
                    <p className="font-label-sm text-label-sm text-on-surface-variant mt-1 flex items-center gap-1 flex-wrap">
                      <span className="font-numeric-data text-on-surface font-semibold">{formatXAF(c.amount)}</span>
                      <span>{t("plusFeeSuffix", { fee: formatXAF(c.fee) })}</span>
                    </p>
                    {(() => {
                      const count = c.membersCount || 1;
                      const pot = Math.round(count * c.amount + count * c.fee * 0.25);
                      return (
                        <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-semibold">
                          <span className="material-symbols-outlined text-[14px] text-emerald-600">emoji_events</span>
                          <span>{t("totalPotToEat")} : {formatXAF(pot)}</span>
                        </div>
                      );
                    })()}
                    <p className="font-label-sm text-label-sm text-red-600 font-semibold mt-1.5 flex items-center gap-1">
                      <span className="material-symbols-outlined text-[16px]">block</span>
                      {t("newMemberNotAllowed")}
                    </p>
                    {(() => {
                      const fallback = getTontineConfig(c.type);
                      const fAmount = c.fineAmountPerPeriod ?? fallback?.fineAmountPerPeriod ?? 500;
                      const fInterval = c.fineIntervalHours ?? fallback?.fineIntervalHours ?? 24;
                      const lTime = c.limitTime || "18:30";
                      return (
                        <details
                          className="mt-1.5 max-w-md relative z-10"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <summary
                            className="cursor-pointer font-label-sm text-[11px] text-amber-700 flex items-center gap-1 hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <span className="material-symbols-outlined text-[13px]">gavel</span>
                            {lang === "fr" ? "Règles des amendes" : "Fine rules"} ({formatXAF(fAmount)})
                          </summary>
                          <p className="font-body-sm text-[11px] text-on-surface-variant/90 mt-1 bg-amber-50/70 p-2 rounded border border-amber-200/60 leading-relaxed">
                            {lang === "fr"
                              ? `Amende de ${formatXAF(fAmount)} après ${lTime}, puis toutes les ${fInterval}h si le paiement n'est pas fait.`
                              : `Fine of ${formatXAF(fAmount)} after ${lTime}, then every ${fInterval}h if unpaid.`}
                          </p>
                        </details>
                      );
                    })()}
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className={`font-label-sm text-label-sm px-2.5 py-1 rounded font-bold tracking-wide uppercase shadow-sm ${c.isActive ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
                      {c.isActive ? t("tagActiveStatus") : (c.isFull ? t("tagFullStatus") : t("tagActiveStatus"))}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
