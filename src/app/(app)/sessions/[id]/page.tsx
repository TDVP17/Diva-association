import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getContributionTotal, getNextDueDate, getCycleDateForRound, getTontineConfig, isPayoutInfoUnlockTime } from "@/lib/tontine-engine";
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
import { PaymentToastBanner } from "./payment-toast-banner";
import { CotisationHeroCard } from "./cotisation-hero-card";
import { TonTourBanner } from "./ton-tour-banner";
import { CotisationMembersList } from "./cotisation-members-list";
import { getDesignatedSlot, assertPriorCyclePaidOut } from "@/lib/round-robin-lock";
import { sessionStatusKey } from "@/lib/session-status-label";
import { assertJoinable, sumRegisteredSlots } from "@/lib/session-joinability";
import { checkUserFinesForJoining } from "@/lib/unsettled-fines-gate";

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

  if (!myMembership || myMembership.status === "REJECTED") {
    const joinCheck = assertJoinable(
      {
        ...tontineSession,
        maxSlots: tontineSession.maxSlots ? Number(tontineSession.maxSlots) : null,
      },
      sumRegisteredSlots(tontineSession.memberships),
    );
    const finesCheck = await checkUserFinesForJoining(userId, id);

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
          {myMembership?.status === "REJECTED" && (
            <div className="w-full max-w-md bg-amber-50 border border-amber-200/80 rounded-xl p-3.5 text-center flex flex-col items-center gap-1.5 my-2 shadow-2xs">
              <div className="flex items-center gap-1.5 text-amber-900 font-bold text-xs sm:text-sm">
                <span className="material-symbols-outlined text-[18px] text-amber-700">info</span>
                <span>{t("previousRequestRejected")}</span>
              </div>
              {myMembership.rejectionReason && (
                <p className="text-xs text-amber-800 bg-amber-100/70 px-2.5 py-1 rounded-md">
                  {lang === "fr" ? `Motif : ${myMembership.rejectionReason}` : `Reason: ${myMembership.rejectionReason}`}
                </p>
              )}
              <p className="text-xs text-slate-600">
                {t("previousRequestRejectedDesc")}
              </p>
            </div>
          )}
          {!finesCheck.canJoin ? (
            <div className="w-full max-w-md bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-center flex flex-col items-center gap-2 mt-2">
              <span className="material-symbols-outlined text-amber-700 text-3xl">warning</span>
              <p className="font-title-sm text-title-sm font-bold text-amber-900">
                {lang === "fr" ? "Amendes impayées à régulariser" : "Outstanding Fines to Settle"}
              </p>
              <p className="font-body-sm text-body-sm text-amber-800">
                {lang === "fr"
                  ? `Vous avez des amendes impayées (${formatXAF(finesCheck.totalUnpaidAmount)}). Selon les règles de l'association, toutes vos amendes doivent être impérativement soldées avant de pouvoir intégrer une nouvelle cotisation.`
                  : `You have unpaid fines (${formatXAF(finesCheck.totalUnpaidAmount)}). All fines must be settled before you can join a new cotisation.`}
              </p>
              <Link
                href="/fines"
                className="mt-2 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-label-md text-label-md transition-colors shadow-sm"
              >
                <span className="material-symbols-outlined text-[18px]">payments</span>
                {lang === "fr" ? "Régulariser mes amendes" : "Settle My Fines"}
              </Link>
            </div>
          ) : (
            <>
              <p className="font-body-md text-body-md text-on-surface-variant">
                {t("notYetMemberBody")}
              </p>
              <div className="w-full max-w-xs">
                <JoinButton tontineSessionId={id} label={t("requestToJoin")} lang={lang} />
              </div>
            </>
          )}
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
        {(() => {
          const registeredOtherSlots = tontineSession.memberships
            .filter((m) => m.status === "APPROVED" && m.id !== myMembership.id)
            .reduce((sum, m) => sum + (m.slotCount ? Number(m.slotCount) : 0), 0);
          const maxSlotsNum = tontineSession.maxSlots ? Number(tontineSession.maxSlots) : null;
          const availableSlots = maxSlotsNum !== null ? Math.max(1, maxSlotsNum - registeredOtherSlots) : null;
          return <SelectSlotsForm tontineSessionId={id} lang={lang} maxAvailableSlots={availableSlots} />;
        })()}
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
  }).sort((a, b) => a.beneficiaryName.localeCompare(b.beneficiaryName, "fr", { sensitivity: "base" }));

  const mySlots = [...myMembership.slots].sort((a, b) =>
    a.beneficiaryName.localeCompare(b.beneficiaryName, "fr", { sensitivity: "base" }),
  );
  const myUndrawnSlots = mySlots.filter((s) => s.ballDrawn === null);
  const hasUndrawnSlots = myUndrawnSlots.length > 0;

  // "Designated" (zero payout rows yet) gates the initial "submit your
  // details" prompt; once submitted, the slot drops out of that query
  // (it now has a row) but the claim itself still needs its own status
  // panel (awaiting release, then awaiting receipt confirmation) — so the
  // two are tracked separately rather than re-using one query for both.
  const designatedSlot = await getDesignatedSlot(id);
  const myDesignatedSlot = designatedSlot && mySlots.some((s) => s.id === designatedSlot.id) ? designatedSlot : null;
  const isBeneficiaryTurn =
    !hasUndrawnSlots && !!myDesignatedSlot && myDesignatedSlot.ballDrawn !== null;

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

  // Find the most recent payer to display in the floating celebration toast banner
  const paidContributionsList = contributions
    .filter((c) => c.status === "PAID")
    .sort((a, b) => (b.paidAt?.getTime() ?? 0) - (a.paidAt?.getTime() ?? 0));
  const recentPayerName =
    paidContributionsList.length > 0
      ? paidContributionsList[0].paidByUser?.name ||
        allSlotsFlat.find((s) => s.id === paidContributionsList[0].membershipSlotId)?.beneficiaryName ||
        null
      : null;

  // Check if the draw is completed and every member has an assigned position
  const hasOfficialPositions =
    allSlotsFlat.length > 0 && allSlotsFlat.every((s) => s.officialPosition !== null);
  const isDrawCompleted =
    (tontineSession.status === "ACTIVE" || tontineSession.status === "CLOSED") &&
    hasOfficialPositions;

  const maxPosition = isDrawCompleted
    ? Math.max(...allSlotsFlat.map((s) => s.officialPosition ?? 1))
    : null;

  const sessionEndDate = isDrawCompleted && maxPosition
    ? getCycleDateForRound(tontineSession.type, tontineSession.startDate, maxPosition)
    : null;

  return (
    <main className="px-container-padding py-stack-gap-lg max-w-3xl lg:max-w-5xl mx-auto w-full pb-32">
      {/* Toast Notification flottant (en haut de l'écran) */}
      <PaymentToastBanner
        sessionLabel={sessionLabel}
        payerName={recentPayerName}
        lang={lang}
      />

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

      {/* 1. Carte Principale de la Cotisation (Cercle Rouge 1) */}
      <CotisationHeroCard
        title={sessionLabel}
        amount={Number(tontineSession.amount)}
        fee={Number(tontineSession.fee ?? 0)}
        frequencyType={tontineSession.type}
        status={tontineSession.status}
        paidCount={paidCount}
        totalSlots={slotCountForPot}
        totalPotAmount={totalPotAmount}
        startDate={tontineSession.startDate}
        endDate={sessionEndDate}
        isDrawCompleted={isDrawCompleted}
        lang={lang}
      />

      {tontineSession.description && (
        <details className="mt-2.5 max-w-xl mx-auto w-full px-1">
          <summary className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200/80 font-medium text-xs hover:bg-emerald-100 transition-colors shadow-2xs list-none [&::-webkit-details-marker]:hidden">
            <span className="text-[13px]">✨</span>
            <span>{t("seeDescription")}</span>
          </summary>
          <p className="font-body-sm text-xs text-on-surface-variant mt-2 whitespace-pre-line leading-relaxed bg-surface-container-low/80 p-3 rounded-xl border border-surface-variant">
            {tontineSession.description}
          </p>
        </details>
      )}

      {/* 2. Bannière Ton tour */}
      {(() => {
        const hasUndrawnSlots = myUndrawnSlots.length > 0;
        const totalSlotsCount = allSlotsFlat.length > 0 ? allSlotsFlat.length : (totalRegisteredSlots || 1);
        const halfThreshold = Math.ceil(totalSlotsCount / 2);
        const isHalfPaid = paidCount >= halfThreshold;
        const isTimeUnlocked = isPayoutInfoUnlockTime(dueDate, now);
        const isBeneficiaryTurn =
          !hasUndrawnSlots && !!myDesignatedSlot && myDesignatedSlot.ballDrawn !== null;
        const canFillPayoutDetails = isBeneficiaryTurn && isHalfPaid && isTimeUnlocked;

        return (
          <>
            <TonTourBanner
              mySlots={mySlots.map((s) => ({
                id: s.id,
                beneficiaryName: s.beneficiaryName,
                officialPosition: s.officialPosition,
                ballDrawn: s.ballDrawn,
              }))}
              sessionType={tontineSession.type}
              startDate={tontineSession.startDate}
              tontineSessionId={id}
              isBeneficiaryTurn={isBeneficiaryTurn}
              lang={lang}
            />

            {(tontineSession.status === "DRAWING" || tontineSession.status === "ACTIVE") &&
              myUndrawnSlots.length > 0 && (
                <Link
                  href={`/sessions/${id}/draw`}
                  className="my-3 flex items-center justify-between bg-emerald-700 hover:bg-emerald-800 text-white rounded-2xl p-4 shadow-md transition-colors"
                >
                  <span className="font-bold text-sm">{t("drawYourBall")}</span>
                  <span className="material-symbols-outlined">casino</span>
                </Link>
              )}

            {/* If beneficiary has drawn their ball, but 18:30 or 50% contributions has not been reached yet */}
            {isBeneficiaryTurn && !myActivePayoutClaim && !canFillPayoutDetails && (
              <div className="mb-stack-gap-lg rounded-2xl border border-emerald-500/30 bg-emerald-50/60 p-4 text-emerald-950 flex items-start gap-3 shadow-xs">
                <span className="material-symbols-outlined text-emerald-700 text-[24px] flex-shrink-0 mt-0.5">
                  hourglass_empty
                </span>
                <div className="min-w-0 flex-1">
                  <h4 className="font-label-md text-sm font-bold text-emerald-950">
                    {lang === "fr" ? "Ordre de bouffe : Tour en attente" : "Payout Turn: Waiting"}
                  </h4>
                  <p className="font-body-sm text-xs text-emerald-900/90 mt-1 leading-relaxed">
                    {!isHalfPaid
                      ? lang === "fr"
                        ? `L'alerte pour renseigner vos coordonnées de paiement s'activera dès que la moitié des membres aura cotisé (${paidCount}/${halfThreshold} cotisations reçues).`
                        : `The prompt to provide your payout details will activate once at least half of the members have contributed (${paidCount}/${halfThreshold} contributions received).`
                      : lang === "fr"
                      ? "Le formulaire pour renseigner vos coordonnées de paiement pour le virement s'activera à 18h30."
                      : "The form to provide your payout details for the transfer will unlock at 6:30 PM."}
                  </p>
                </div>
              </div>
            )}

            {/* PayoutTurnPanel is only rendered if an active claim exists, OR if the beneficiary can fill details (ball drawn, >= 50% paid, and time >= 18:30) */}
            {(myActivePayoutClaim || canFillPayoutDetails) && (
              <PayoutTurnPanel
                membershipSlotId={myActivePayoutClaim?.membershipSlotId ?? myDesignatedSlot!.id}
                payoutId={myActivePayoutClaim?.id ?? null}
                status={myActivePayoutClaim?.status ?? null}
                lang={lang}
              />
            )}
          </>
        );
      })()}

      {/* 3. Section Membres avec vérification KYC et boutons de paiement */}
      <CotisationMembersList
        members={memberStatusSlots.map((s) => ({
          id: s.id,
          beneficiaryName: s.beneficiaryName,
          isMine: s.isMine,
          paid: s.paid,
          paidAtLabel: s.paidAtLabel,
          paidByRelativeName: s.paidByRelativeName,
          fineAmount: s.fineAmount,
          ballDrawn: s.ballDrawn,
          officialPosition: s.officialPosition,
        }))}
        myUnpaidSlotIds={mySlots
          .filter((s) => contributionBySlot.get(s.id)?.status !== "PAID")
          .map((s) => s.id)}
        slotTotal={perSlotTotal}
        paymentDescription={paymentDescription}
        defaultPhone={myMembership.user.phone}
        lang={lang}
        isDraftSession={!isDrawCompleted}
        isBeneficiaryTurn={isBeneficiaryTurn}
        lockedReason={
          !isDrawCompleted
            ? t("paymentsLockedNoPayoutOrder")
            : !roundLock.ok && currentBeneficiaryName && !isBeneficiaryTurn
            ? t("paymentsLockedUntilPayout", { name: currentBeneficiaryName })
            : undefined
        }
      />

      {/* Sections secondaires pliables : Ordre de bouffe EN PREMIER avant mes noms enregistrés */}
      <div className="mt-6 flex flex-col gap-3">
        <PayoutOrderAccordion tontineSessionId={id} lang={lang} />

        <MemberNamesManager
          tontineSessionId={id}
          lang={lang}
          currentNames={mySlots.map((s) => s.beneficiaryName)}
          sessionStatus={tontineSession.status}
          maxSlots={tontineSession.maxSlots ? Number(tontineSession.maxSlots) : null}
          startDate={tontineSession.startDate}
        />

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
