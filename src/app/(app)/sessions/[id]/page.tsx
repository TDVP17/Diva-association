import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getContributionTotal, getNextDueDate, getCycleDateForRound, getTontineConfig } from "@/lib/tontine-engine";
import { getLang, getTranslator } from "@/lib/i18n/get-lang";
import { formatXAF } from "@/lib/format-currency";
import { FinesInfoAccordion } from "./fines-info-accordion";
import { PayButton } from "./pay-button";
import { JoinButton } from "./join-button";
import { VerificationPollingRefresh } from "./verification-status";
import { SelectSlotsForm } from "./select-slots-form";
import { MemberNamesManager } from "./member-names-manager";
import { YourSlotsAccordion } from "./your-slots-accordion";
import { PayoutOrderAccordion } from "./payout-order-accordion";
import { MemberStatusAccordion } from "./member-status-accordion";
import { PayoutTurnPanel } from "./payout-turn-panel";
import { PaymentSuccessBanner } from "./payment-success-banner";
import { SwapRequestPanel } from "./swap-request-panel";
import { getDesignatedSlot, assertPriorCyclePaidOut } from "@/lib/round-robin-lock";
import { sessionStatusKey } from "@/lib/session-status-label";
import { assertJoinable, sumRegisteredSlots } from "@/lib/session-joinability";

const TONTINE_LABELS: Record<string, string> = {
  HEBDO_SUNDAY: "Weekly Tontine (Sunday)",
  MONTHLY_28: "Monthly Tontine (28th)",
  MONTHLY_25: "Monthly Tontine (25th)",
  BIWEEKLY_SUNDAY: "Every 2 Weeks (Sunday)",
  QUARTERLY_25: "Every 3 Months (25th)",
};

/**
 * Loads a PAID contribution for the post-payment success banner, scoped to
 * whoever is allowed to see it — the beneficiary's own membership owner or
 * (for relative/admin payments) the payer themselves. Never trusts a
 * ?payment= id alone; always re-derives from the trusted DB row rather than
 * anything the redirect URL implies, so it can't be spoofed to view someone
 * else's transaction.
 */
async function loadPaidContribution(contributionId: string, requestingUserId: string) {
  const contribution = await prisma.contribution.findUnique({
    where: { id: contributionId },
    include: {
      membershipSlot: { include: { membership: { include: { user: true, tontineSession: true } } } },
      paidByUser: true,
    },
  });
  if (!contribution || contribution.status !== "PAID") return null;

  const beneficiaryOwnerId = contribution.membershipSlot.membership.userId;
  const payerId = contribution.paidByUserId ?? beneficiaryOwnerId;
  if (requestingUserId !== beneficiaryOwnerId && requestingUserId !== payerId) return null;

  return contribution;
}

export default async function SessionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ payment?: string }>;
}) {
  const { id } = await params;
  const { payment: paymentId } = await searchParams;
  const session = await auth();
  if (!session?.user) redirect("/login");
  const userId = session.user.id;
  const lang = await getLang();
  const t = getTranslator(lang);

  const tontineSession = await prisma.tontineSession.findUnique({
    where: { id },
    include: {
      memberships: {
        include: {
          user: { select: { id: true, name: true, avatar: true, image: true, phone: true } },
          slots: { orderBy: [{ officialPosition: "asc" }, { ballDrawn: "asc" }, { createdAt: "asc" }] },
        },
      },
    },
  });
  if (!tontineSession) notFound();

  const fallbackConfig = getTontineConfig(tontineSession.type);
  const fineAmount = tontineSession.fineAmountPerPeriod
    ? Number(tontineSession.fineAmountPerPeriod)
    : (fallbackConfig?.fineAmountPerPeriod ?? 500);
  const fineIntervalHours = tontineSession.fineIntervalHours ?? fallbackConfig?.fineIntervalHours ?? 24;
  const limitTime = tontineSession.limitTime || "18:30";

  const myMembership = tontineSession.memberships.find((m) => m.userId === userId);
  const sessionLabel = tontineSession.title || TONTINE_LABELS[tontineSession.type];

  if (!myMembership) {
    const joinCheck = assertJoinable(
      {
        ...tontineSession,
        maxSlots: tontineSession.maxSlots ? Number(tontineSession.maxSlots) : null,
      },
      sumRegisteredSlots(tontineSession.memberships),
    );

    if (!joinCheck.ok) {
      const regSlots = sumRegisteredSlots(tontineSession.memberships);
      const isFull = tontineSession.maxSlots !== null && regSlots >= Number(tontineSession.maxSlots);
      return (
        <main className="px-container-padding py-stack-gap-lg max-w-3xl lg:max-w-5xl mx-auto w-full">
          <section className="bg-surface rounded-xl p-6 shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant flex flex-col items-center text-center gap-4">
            <div className="w-14 h-14 rounded-full bg-red-100 text-red-600 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl">block</span>
            </div>
            <div>
              <div className="inline-block px-2.5 py-1 mb-2 rounded bg-red-600 text-white font-bold text-xs uppercase tracking-wide">
                {isFull ? t("tagFullStatus") : t("tagActiveStatus")}
              </div>
              <h1 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface">
                {sessionLabel}
              </h1>
              {tontineSession.description && (
                <details className="mt-2 max-w-md mx-auto w-full">
                  <summary className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200/80 font-medium text-xs hover:bg-emerald-100 transition-colors shadow-2xs list-none [&::-webkit-details-marker]:hidden mx-auto">
                    <span className="text-[13px]">✨</span>
                    <span>{t("seeDescription")}</span>
                  </summary>
                  <p className="font-body-md text-body-md text-on-surface-variant mt-2 whitespace-pre-line bg-surface-container-low/70 p-3 rounded-lg border border-surface-variant">
                    {tontineSession.description}
                  </p>
                </details>
              )}
              <p className="font-body-md text-body-md text-red-600 font-semibold mt-1 flex items-center justify-center gap-1">
                <span className="material-symbols-outlined text-[18px]">block</span>
                {t("newMemberNotAllowed")}
              </p>
              <p className="font-body-md text-body-md text-on-surface-variant mt-2 max-w-md mx-auto">
                {t("sessionClosedToNewMembers")}
              </p>
            </div>

            <div className="w-full max-w-md bg-surface-container-low rounded-xl p-4 border border-surface-variant text-left grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-on-surface-variant text-xs">{t("startsOn")}</p>
                <p className="font-semibold text-on-surface">
                  {tontineSession.startDate.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </p>
              </div>
              <div>
                <p className="text-on-surface-variant text-xs">{t("contributionLabel")}</p>
                <p className="font-semibold text-on-surface">{formatXAF(Number(tontineSession.amount))}</p>
              </div>
              <div>
                <p className="text-on-surface-variant text-xs">{t("feeLabel")}</p>
                <p className="font-semibold text-on-surface">{formatXAF(Number(tontineSession.fee))}</p>
              </div>
              <div>
                <p className="text-on-surface-variant text-xs">{t("validatedMembersCount", { count: "" }).replace("{count}", "").trim()}</p>
                <p className="font-semibold text-on-surface">
                  {(() => {
                    const approvedCount = tontineSession.memberships.filter((m) => m.status === "APPROVED").length;
                    return approvedCount > 0 ? approvedCount : (tontineSession.validatedMembersCount ?? 0);
                  })()}
                  {tontineSession.maxSlots ? ` / ${tontineSession.maxSlots}` : ""}
                </p>
              </div>
            </div>

            <Link
              href="/sessions"
              className="mt-2 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white font-label-md text-label-md hover:bg-primary/90 transition-colors"
            >
              <span className="material-symbols-outlined text-[18px]">arrow_back</span>
              {t("viewOpenCotisations")}
            </Link>
          </section>
          <div className="mt-stack-gap-lg">
            <FinesInfoAccordion
              lang={lang}
              fineAmount={fineAmount}
              fineIntervalHours={fineIntervalHours}
              limitTime={limitTime}
            />
          </div>
        </main>
      );
    }

    const latestVerification = await prisma.kycVerification.findFirst({
      where: { userId, tontineSessionId: id },
      orderBy: { createdAt: "desc" },
    });

    if (latestVerification?.status === "PENDING") {
      return (
        <main className="px-container-padding py-stack-gap-lg max-w-3xl lg:max-w-5xl mx-auto w-full">
          <VerificationPollingRefresh />
          <section className="bg-surface rounded-xl p-6 shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant text-center flex flex-col items-center gap-2">
            <span className="material-symbols-outlined text-primary text-4xl">hourglass_top</span>
            <h1 className="font-title-md text-title-md text-primary">{t("verificationInProgress")}</h1>
            <p className="font-body-md text-body-md text-on-surface-variant">
              {t("verificationInProgressBody", { session: sessionLabel })}
            </p>
          </section>
        </main>
      );
    }

    if (latestVerification?.status === "FAILED") {
      return (
        <main className="px-container-padding py-stack-gap-lg max-w-3xl lg:max-w-5xl mx-auto w-full">
          <section className="bg-surface rounded-xl p-6 shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant text-center flex flex-col items-center gap-3">
            <span className="material-symbols-outlined text-error text-4xl">gpp_bad</span>
            <h1 className="font-title-md text-title-md text-error">{t("verificationFailed")}</h1>
            <p className="font-body-md text-body-md text-on-surface-variant">
              {t("verificationFailedBody", { session: sessionLabel })}
            </p>
            <div className="w-full max-w-xs">
              <JoinButton tontineSessionId={id} label={t("tryAgain")} lang={lang} />
            </div>
          </section>
        </main>
      );
    }

    return (
      <main className="px-container-padding py-stack-gap-lg max-w-3xl lg:max-w-5xl mx-auto w-full">
        <section className="bg-surface rounded-xl p-6 shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant text-center flex flex-col items-center gap-3">
          <span className="material-symbols-outlined text-primary text-4xl">groups</span>
          <h1 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface">
            {sessionLabel}
          </h1>
          {tontineSession.description && (
            <details className="max-w-lg mx-auto w-full">
              <summary className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200/80 font-medium text-xs hover:bg-emerald-100 transition-colors shadow-2xs list-none [&::-webkit-details-marker]:hidden mx-auto">
                <span className="text-[13px]">✨</span>
                <span>{t("seeDescription")}</span>
              </summary>
              <p className="font-body-md text-body-md text-on-surface-variant mt-2 bg-surface-container-low/80 p-3.5 rounded-lg border border-surface-variant text-left whitespace-pre-line">
                {tontineSession.description}
              </p>
            </details>
          )}
          <p className="font-body-md text-body-md text-on-surface-variant">
            {t("notYetMemberBody")}
          </p>
          <div className="w-full max-w-xs">
            <JoinButton tontineSessionId={id} label={t("requestToJoin")} lang={lang} />
          </div>
        </section>
        <div className="mt-stack-gap-lg">
          <FinesInfoAccordion
            lang={lang}
            fineAmount={fineAmount}
            fineIntervalHours={fineIntervalHours}
            limitTime={limitTime}
          />
        </div>
      </main>
    );
  }

  if (myMembership.status === "PENDING") {
    return (
      <main className="px-container-padding py-stack-gap-lg max-w-3xl lg:max-w-5xl mx-auto w-full">
        <section className="bg-surface rounded-xl p-6 shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant text-center flex flex-col items-center gap-2">
          <span className="material-symbols-outlined text-primary text-4xl">hourglass_top</span>
          <h1 className="font-title-md text-title-md text-primary">{t("approvalPending")}</h1>
          <h2 className="font-title-sm text-title-sm text-on-surface font-semibold">{sessionLabel}</h2>
          {tontineSession.description && (
            <details className="max-w-lg mx-auto w-full">
              <summary className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200/80 font-medium text-xs hover:bg-emerald-100 transition-colors shadow-2xs list-none [&::-webkit-details-marker]:hidden mx-auto">
                <span className="text-[13px]">✨</span>
                <span>{t("seeDescription")}</span>
              </summary>
              <p className="font-body-md text-body-md text-on-surface-variant mt-2 bg-surface-container-low/80 p-3 rounded-lg border border-surface-variant text-left whitespace-pre-line">
                {tontineSession.description}
              </p>
            </details>
          )}
          <p className="font-body-md text-body-md text-on-surface-variant">
            {t("approvalPendingBody", { session: sessionLabel })}
          </p>
        </section>
        <div className="mt-stack-gap-lg">
          <FinesInfoAccordion
            lang={lang}
            fineAmount={fineAmount}
            fineIntervalHours={fineIntervalHours}
            limitTime={limitTime}
          />
        </div>
      </main>
    );
  }

  if (myMembership.status === "BANNED") {
    return (
      <main className="px-container-padding py-stack-gap-lg max-w-3xl lg:max-w-5xl mx-auto w-full">
        <section className="bg-surface rounded-xl p-6 shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant text-center flex flex-col items-center gap-3">
          <div className="w-14 h-14 rounded-full bg-red-100 text-red-600 flex items-center justify-center">
            <span className="material-symbols-outlined text-3xl">block</span>
          </div>
          <h1 className="font-title-md text-title-md text-error">
            {lang === "fr" ? "Accès banni" : "Access Banned"}
          </h1>
          <p className="font-body-md text-body-md text-on-surface-variant max-w-md">
            {lang === "fr"
              ? `Vous avez été banni de la cotisation « ${sessionLabel} » par l'administrateur. Vous ne pouvez plus faire de demande d'intégration.`
              : `You have been banned from "${sessionLabel}" by the administrator. You cannot request to join.`}
          </p>
          {myMembership.rejectionReason && (
            <p className="font-label-sm text-xs text-error bg-error-container/20 px-3 py-1.5 rounded-lg">
              {lang === "fr" ? `Motif : ${myMembership.rejectionReason}` : `Reason: ${myMembership.rejectionReason}`}
            </p>
          )}
          <Link
            href="/sessions"
            className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-surface-container-high text-on-surface font-label-md text-label-md hover:bg-surface-variant transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            {t("viewOpenCotisations")}
          </Link>
        </section>
      </main>
    );
  }

  if (myMembership.status === "REJECTED") {
    return (
      <main className="px-container-padding py-stack-gap-lg max-w-3xl lg:max-w-5xl mx-auto w-full">
        <section className="bg-surface rounded-xl p-6 shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant text-center flex flex-col items-center gap-3">
          <span className="material-symbols-outlined text-amber-600 text-4xl">warning</span>
          <h1 className="font-title-md text-title-md text-on-surface">{t("requestRejectedTitle")}</h1>
          <p className="font-body-md text-body-md text-on-surface-variant">
            {t("requestRejectedBody", { session: sessionLabel })}
          </p>
          {myMembership.rejectionReason && (
            <p className="font-label-sm text-xs text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg">
              {lang === "fr" ? `Motif : ${myMembership.rejectionReason}` : `Reason: ${myMembership.rejectionReason}`}
            </p>
          )}
          <div className="w-full max-w-xs mt-2">
            <JoinButton tontineSessionId={id} label={t("requestAgain")} lang={lang} />
          </div>
        </section>
      </main>
    );
  }

  // APPROVED but hasn't picked slots yet — mandatory one-time step.
  if (myMembership.slotCount === null) {
    return (
      <main className="px-container-padding py-stack-gap-lg max-w-3xl lg:max-w-5xl mx-auto w-full">
        <section className="bg-surface rounded-xl p-6 shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant text-center flex flex-col items-center gap-3 mb-stack-gap-lg">
          <span className="material-symbols-outlined text-primary text-4xl">confirmation_number</span>
          <h1 className="font-title-md text-title-md text-primary">{t("selectYourSlots")}</h1>
          <h2 className="font-title-sm text-title-sm text-on-surface font-semibold">{sessionLabel}</h2>
          {tontineSession.description && (
            <details className="max-w-lg mx-auto w-full">
              <summary className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200/80 font-medium text-xs hover:bg-emerald-100 transition-colors shadow-2xs list-none [&::-webkit-details-marker]:hidden mx-auto">
                <span className="text-[13px]">✨</span>
                <span>{t("seeDescription")}</span>
              </summary>
              <p className="font-body-md text-body-md text-on-surface-variant mt-2 bg-surface-container-low/80 p-3 rounded-lg border border-surface-variant text-left whitespace-pre-line">
                {tontineSession.description}
              </p>
            </details>
          )}
          <p className="font-body-md text-body-md text-on-surface-variant">
            {t("selectYourSlotsBody", { session: sessionLabel })}
          </p>
        </section>
        <SelectSlotsForm tontineSessionId={id} lang={lang} />
        <div className="mt-stack-gap-lg">
          <FinesInfoAccordion
            lang={lang}
            fineAmount={fineAmount}
            fineIntervalHours={fineIntervalHours}
            limitTime={limitTime}
          />
        </div>
      </main>
    );
  }

  const approvedMemberships = tontineSession.memberships.filter((m) => m.status === "APPROVED");
  const totalRegisteredSlots = approvedMemberships.reduce(
    (sum, m) => sum + (m.slotCount ? Number(m.slotCount) : 0),
    0,
  );

  const now = new Date();
  const dueDate = getNextDueDate(tontineSession.type, now);
  const { total: perSlotTotal } = getContributionTotal({
    amount: Number(tontineSession.amount),
    fee: Number(tontineSession.fee),
  });
  const paymentDescription = `${t("paymentDescriptionPrefix")}: ${sessionLabel} — ${dueDate.toLocaleDateString("en-GB", {
    timeZone: "Africa/Douala",
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;

  const allSlotIds = approvedMemberships.flatMap((m) => m.slots.map((s) => s.id));
  const [contributions, fines] = allSlotIds.length
    ? await Promise.all([
        prisma.contribution.findMany({
      where: { membershipSlotId: { in: allSlotIds }, dueDate },
      include: { paidByUser: { select: { name: true } } },
    }),
        prisma.fine.findMany({ where: { membershipSlotId: { in: allSlotIds }, dueDate, status: "UNPAID" } }),
      ])
    : [[], []];

  const contributionBySlot = new Map(contributions.map((c) => [c.membershipSlotId, c]));
  const fineBySlot = new Map(fines.map((f) => [f.membershipSlotId, f]));

  const allSlotsFlat = approvedMemberships.flatMap((m) =>
    m.slots.map((s) => ({ ...s, member: m.user, isMine: m.userId === userId })),
  );
  const paidCount = allSlotsFlat.filter((s) => contributionBySlot.get(s.id)?.status === "PAID").length;

  const perSlotAmount = Number(tontineSession.amount);
  const perSlotFee = Number(tontineSession.fee);
  const slotCountForPot =
    totalRegisteredSlots > 0
      ? totalRegisteredSlots
      : tontineSession.maxSlots
        ? Number(tontineSession.maxSlots)
        : (allSlotsFlat.length || 1);
  const totalPotAmount = Math.round(slotCountForPot * perSlotAmount + slotCountForPot * perSlotFee * 0.25);

  const memberStatusSlots = allSlotsFlat.map((s) => {
    const c = contributionBySlot.get(s.id);
    const f = fineBySlot.get(s.id);
    const paid = c?.status === "PAID";
    const slotDateLabel = s.officialPosition
      ? getCycleDateForRound(tontineSession.type, tontineSession.startDate, s.officialPosition).toLocaleDateString(
          lang === "fr" ? "fr-FR" : "en-GB",
          { timeZone: "Africa/Douala", day: "numeric", month: "short", year: "numeric" },
        )
      : null;
    return {
      id: s.id,
      beneficiaryName: s.beneficiaryName,
      ballDrawn: s.ballDrawn,
      officialPosition: s.officialPosition,
      isMine: s.isMine,
      paid,
      paidAtLabel: c?.paidAt ? c.paidAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : null,
      paidByRelativeName: c?.paidByUser?.name ?? null,
      fineAmount: f ? Number(f.amount) : null,
      estimatedDateLabel: slotDateLabel,
    };
  });

  const mySlots = [...myMembership.slots].sort((a, b) =>
    a.beneficiaryName.localeCompare(b.beneficiaryName, "fr", { sensitivity: "base" }),
  );
  const myUndrawnSlots = mySlots.filter((s) => s.ballDrawn === null);

  // "Designated" (zero payout rows yet) gates the initial "submit your
  // details" prompt; once submitted, the slot drops out of that query
  // (it now has a row) but the claim itself still needs its own status
  // panel (awaiting release, then awaiting receipt confirmation) — so the
  // two are tracked separately rather than re-using one query for both.
  const designatedSlot = await getDesignatedSlot(id);
  const myDesignatedSlot = designatedSlot && mySlots.some((s) => s.id === designatedSlot.id) ? designatedSlot : null;

  // Same read-only guard initiateSlotPayment() enforces server-side — shown
  // here so the Pay button is disabled up front instead of only failing
  // after the member taps it and opens the confirm dialog. designatedSlot
  // above is exactly who assertPriorCyclePaidOut would report as still
  // owed a payout, so it's reused instead of querying it again.
  const roundLock = await assertPriorCyclePaidOut(
    tontineSession.id,
    tontineSession.type,
    dueDate,
    tontineSession.startDate,
  );
  const currentBeneficiaryName = roundLock.ok ? null : designatedSlot?.beneficiaryName;
  const myActivePayoutClaim = await prisma.payout.findFirst({
    where: { membershipSlotId: { in: mySlots.map((s) => s.id) }, status: { not: "CONFIRMED" } },
    orderBy: { detailsSubmittedAt: "desc" },
  });

  // Only render for the paid contribution's own payer or beneficiary — a
  // guessed ?payment= id from someone else must never leak amounts/names.
  let paidContribution: Awaited<ReturnType<typeof loadPaidContribution>> = null;
  if (paymentId) {
    paidContribution = await loadPaidContribution(paymentId, userId);
  }

  // Position-exchange data — only meaningful once positions exist to swap
  // (DRAWING/ACTIVE), matching what the old chat-based "Request Exchange"
  // button required. One representative slot per co-member (earliest
  // created), same simplification the removed common-sessions route used.
  let coMembers: { userId: string; name: string; avatar: string | null; position: number | null }[] = [];
  let myPosition: number | null = null;
  let pendingSwapRequests: {
    id: string;
    requesterId: string;
    targetId: string;
    requesterName: string;
    targetName: string;
    status: "PENDING_MEMBERSHIP" | "PENDING_ADMIN" | "APPROVED" | "REJECTED";
  }[] = [];
  if (tontineSession.status === "DRAWING" || tontineSession.status === "ACTIVE") {
    const coMembersMap = new Map<string, { userId: string; name: string; avatar: string | null; position: number | null }>();
    for (const m of approvedMemberships) {
      if (m.userId === userId || coMembersMap.has(m.userId)) continue;
      const firstSlot = [...m.slots].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
      coMembersMap.set(m.userId, {
        userId: m.userId,
        name: m.user.name,
        avatar: m.user.avatar ?? m.user.image ?? null,
        position: firstSlot?.officialPosition ?? firstSlot?.ballDrawn ?? null,
      });
    }
    coMembers = [...coMembersMap.values()];

    const myFirstSlot = [...myMembership.slots].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
    myPosition = myFirstSlot?.officialPosition ?? myFirstSlot?.ballDrawn ?? null;

    const rawSwapRequests = await prisma.positionSwapRequest.findMany({
      where: {
        tontineSessionId: id,
        status: { in: ["PENDING_MEMBERSHIP", "PENDING_ADMIN"] },
        OR: [{ requesterId: userId }, { targetId: userId }],
      },
      include: { requester: { select: { name: true } }, target: { select: { name: true } } },
    });
    pendingSwapRequests = rawSwapRequests.map((r) => ({
      id: r.id,
      requesterId: r.requesterId,
      targetId: r.targetId,
      requesterName: r.requester.name,
      targetName: r.target.name,
      status: r.status,
    }));
  }

  return (
    <main className="px-container-padding py-stack-gap-lg max-w-3xl lg:max-w-5xl mx-auto w-full pb-32">
      {paidContribution && (
        <PaymentSuccessBanner
          lang={lang}
          beneficiaryName={paidContribution.membershipSlot.beneficiaryName}
          sessionLabel={sessionLabel}
          amount={
            Number(paidContribution.amountPaid) + Number(paidContribution.feePaid) + Number(paidContribution.finePaid)
          }
          paymentFee={Number(paidContribution.providerFeeAmount ?? 0)}
          paidByName={paidContribution.paidByUser?.name ?? paidContribution.membershipSlot.membership.user.name}
          date={(paidContribution.paidAt ?? paidContribution.dueDate).toLocaleDateString("en-GB", {
            timeZone: "Africa/Douala",
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
          time={(paidContribution.paidAt ?? paidContribution.dueDate).toLocaleTimeString("en-GB", {
            timeZone: "Africa/Douala",
            hour: "2-digit",
            minute: "2-digit",
          })}
          transRef={paidContribution.fapshiTxRef ?? paidContribution.id}
          receiptUrl={paidContribution.receiptPdfUrl ? `/api/files/${paidContribution.receiptPdfUrl}` : null}
        />
      )}
      <section className="mb-3.5 bg-surface rounded-xl p-3.5 sm:p-4 shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant">
        {/* En-tête : Titre, statut et stats clés */}
        <div className="flex items-start justify-between gap-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap mb-1">
              <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-secondary-container/20 text-on-secondary-container font-label-sm text-[10px] uppercase tracking-wider font-bold">
                {t(sessionStatusKey(tontineSession.status))}
              </span>
              {totalPotAmount > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200/80 font-bold text-[11px]">
                  <span>💰</span>
                  <span>{formatXAF(totalPotAmount)}</span>
                </span>
              )}
            </div>
            <h1 className="text-base sm:text-lg font-bold text-on-surface truncate">{sessionLabel}</h1>
            {tontineSession.description && (
              <details className="mt-1 max-w-xl">
                <summary className="cursor-pointer inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200/80 font-medium text-[11px] hover:bg-emerald-100 transition-colors shadow-2xs list-none [&::-webkit-details-marker]:hidden">
                  <span className="text-[12px]">✨</span>
                  <span>{t("seeDescription")}</span>
                </summary>
                <p className="font-body-sm text-xs text-on-surface-variant mt-1.5 whitespace-pre-line leading-relaxed bg-surface-container-low/70 p-2.5 rounded-lg border border-surface-variant/70">
                  {tontineSession.description}
                </p>
              </details>
            )}
          </div>

          <div className="text-right flex-shrink-0 bg-primary/5 border border-primary/10 px-2.5 py-1.5 rounded-lg">
            <div className="text-[10px] text-on-surface-variant font-medium leading-none mb-0.5">{t("totalRegisteredSlots")}</div>
            <div className="font-numeric-data text-sm sm:text-base font-bold text-primary">
              {totalRegisteredSlots}{tontineSession.maxSlots ? ` / ${Number(tontineSession.maxSlots)}` : ""}
            </div>
          </div>
        </div>

        {/* Ligne compacte : Date et Échéance */}
        <div className="mt-2.5 pt-2 border-t border-surface-variant/60 flex items-center justify-between text-xs text-on-surface-variant gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            <span className="material-symbols-outlined text-[15px] text-primary">event</span>
            <span>
              {lang === "fr" ? "Début :" : "Starts:"}{" "}
              <strong className="text-on-surface font-semibold">
                {tontineSession.startDate.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-GB", {
                  timeZone: "Africa/Douala",
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </strong>
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="material-symbols-outlined text-[15px] text-amber-600">schedule</span>
            <span>
              {t("deadlineLabel")}: <strong className="text-on-surface font-semibold">{tontineSession.limitTime}</strong>
            </span>
          </div>
        </div>

        {/* Barre de progression des paiements */}
        <div className="mt-2 pt-2 border-t border-surface-variant/60 flex items-center justify-between gap-3">
          <div className="font-label-sm text-xs text-on-surface-variant">
            {paidCount}/{allSlotsFlat.length} {t("slotsPaidThisCycle")}
          </div>
          <div className="w-24 sm:w-32 h-1.5 bg-surface-variant rounded-full overflow-hidden flex-shrink-0">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${allSlotsFlat.length ? (paidCount / allSlotsFlat.length) * 100 : 0}%` }}
            />
          </div>
        </div>
      </section>

      {(tontineSession.status === "DRAWING" || tontineSession.status === "ACTIVE") &&
        myUndrawnSlots.length > 0 && (
          <Link
            href={`/sessions/${id}/draw`}
            className="mb-stack-gap-lg flex items-center justify-between bg-primary text-on-primary rounded-xl p-4 shadow-md hover:opacity-90 transition-opacity"
          >
            <span className="font-label-md text-label-md">{t("drawYourBall")}</span>
            <span className="material-symbols-outlined">casino</span>
          </Link>
        )}

      {(myActivePayoutClaim || myDesignatedSlot) && (
        <PayoutTurnPanel
          membershipSlotId={myActivePayoutClaim?.membershipSlotId ?? myDesignatedSlot!.id}
          payoutId={myActivePayoutClaim?.id ?? null}
          status={myActivePayoutClaim?.status ?? null}
          lang={lang}
        />
      )}

      {/* Vos noms : fermé par défaut avec accordéon pour ouvrir comme les autres */}
      <YourSlotsAccordion
        lang={lang}
        title={t("yourSlots")}
        slotsCount={mySlots.length}
        paidCount={mySlots.filter((s) => contributionBySlot.get(s.id)?.status === "PAID").length}
      >
        <div className="bg-surface overflow-hidden">
          {mySlots.map((s, index) => {
            const c = contributionBySlot.get(s.id);
            const f = fineBySlot.get(s.id);
            const paid = c?.status === "PAID";
            const slotTotal = perSlotTotal + (f ? Number(f.amount) : 0);
            const slotDateLabel = s.officialPosition
              ? getCycleDateForRound(tontineSession.type, tontineSession.startDate, s.officialPosition).toLocaleDateString(
                  lang === "fr" ? "fr-FR" : "en-GB",
                  { timeZone: "Africa/Douala", day: "numeric", month: "short", year: "numeric" },
                )
              : null;
            const notReadyForPayment = tontineSession.status === "DRAFT";
            return (
              <div
                key={s.id}
                className={`flex items-center p-4 ${index < mySlots.length - 1 ? "border-b border-surface-variant" : ""}`}
              >
                <div className="flex items-center gap-3 flex-grow min-w-0 mr-2">
                  <div className="flex-shrink-0">
                    {paid ? (
                      <div className="w-8 h-8 rounded-full bg-[#d1fae5] text-[#059669] flex items-center justify-center shadow-xs" title={t("paid")}>
                        <span className="material-symbols-outlined text-[20px] font-bold">check_circle</span>
                      </div>
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center border border-slate-200" title={t("due")}>
                        <span className="material-symbols-outlined text-[20px]">radio_button_unchecked</span>
                      </div>
                    )}
                  </div>
                  <div className="flex-grow min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-label-md text-label-md text-on-surface truncate font-semibold">
                        {s.beneficiaryName}
                      </span>
                      {paid ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold bg-[#d1fae5] text-[#065f46]">
                          <span className="material-symbols-outlined text-[13px]">check</span>
                          {t("paid")}
                        </span>
                      ) : myDesignatedSlot ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold bg-amber-100 text-amber-900 border border-amber-300">
                          <span className="material-symbols-outlined text-[13px] text-amber-700">redeem</span>
                          {lang === "fr" ? "Tour de bouffe (déductible du gain)" : "Payout turn (deductible)"}
                        </span>
                      ) : null}
                    </div>
                    <div className="font-label-sm text-label-sm text-on-surface-variant">
                      {t("positionLabel")} {s.ballDrawn ?? t("notYetRevealed")} ·{" "}
                      {paid ? (
                        <span>
                          {c?.paidAt ? t("paidAtLabel", { time: c.paidAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) }) : t("paid")}
                          {c?.paidByUser && (
                            <span className="text-primary font-medium"> · {t("paidByRelativeBadge", { name: c.paidByUser.name })}</span>
                          )}
                        </span>
                      ) : myDesignatedSlot ? (
                        <span className="text-amber-900 font-medium">
                          {formatXAF(slotTotal)} · {lang === "fr" ? "Paiement au choix (déduit du virement si non payé)" : "Optional (deducted if unpaid)"}
                        </span>
                      ) : (
                        <span>{formatXAF(slotTotal)} {t("due")}</span>
                      )}
                    </div>
                    {slotDateLabel && (
                      <div className="font-label-sm text-[11px] text-on-surface-variant flex items-center gap-1 mt-0.5">
                        <span className="material-symbols-outlined text-[13px]">event</span>
                        {t("estimatedDateLabel")}: {slotDateLabel}
                      </div>
                    )}
                  </div>
                </div>
                {!paid && (
                  <PayButton
                    membershipSlotId={s.id}
                    beneficiaryName={s.beneficiaryName}
                    amountLabel={formatXAF(slotTotal)}
                    description={paymentDescription}
                    defaultPhone={myMembership.user.phone}
                    lang={lang}
                    isBeneficiaryTurn={!!myDesignatedSlot}
                    lockedReason={
                      notReadyForPayment
                        ? t("paymentsAvailableAfterDraw")
                        : !roundLock.ok && currentBeneficiaryName && !myDesignatedSlot
                          ? t("paymentsLockedUntilPayout", { name: currentBeneficiaryName })
                          : undefined
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
      </YourSlotsAccordion>

      {/* Mes noms enregistrés */}
      <MemberNamesManager
        tontineSessionId={id}
        lang={lang}
        currentNames={mySlots.map((s) => s.beneficiaryName)}
        sessionStatus={tontineSession.status}
        maxSlots={tontineSession.maxSlots ? Number(tontineSession.maxSlots) : null}
        startDate={tontineSession.startDate}
      />

      {/* Ordre de versement */}
      <PayoutOrderAccordion tontineSessionId={id} lang={lang} />

      {/* Statut des membres */}
      <MemberStatusAccordion slots={memberStatusSlots} lang={lang} />

      {/* Demandes de permutation */}
      <SwapRequestPanel
        tontineSessionId={id}
        currentUserId={userId}
        myPosition={myPosition}
        coMembers={coMembers}
        pendingRequests={pendingSwapRequests}
        lang={lang}
      />

      {/* Explication du fonctionnement des amendes (fermé par défaut, à la fin) */}
      <FinesInfoAccordion
        lang={lang}
        fineAmount={fineAmount}
        fineIntervalHours={fineIntervalHours}
        limitTime={limitTime}
      />
    </main>
  );
}
