import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getContributionTotal, getNextDueDate, getCycleDateForRound } from "@/lib/tontine-engine";
import { getLang, getTranslator } from "@/lib/i18n/get-lang";
import { formatXAF } from "@/lib/format-currency";
import { PayButton } from "./pay-button";
import { JoinButton } from "./join-button";
import { VerificationPollingRefresh } from "./verification-status";
import { SelectSlotsForm } from "./select-slots-form";
import { PayoutOrderModal } from "./payout-order-modal";
import { PayoutTurnPanel } from "./payout-turn-panel";
import { PaymentSuccessBanner } from "./payment-success-banner";
import { SwapRequestPanel } from "./swap-request-panel";
import { getDesignatedSlot, assertPriorCyclePaidOut } from "@/lib/round-robin-lock";
import { sessionStatusKey } from "@/lib/session-status-label";

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

  const myMembership = tontineSession.memberships.find((m) => m.userId === userId);
  const sessionLabel = tontineSession.title || TONTINE_LABELS[tontineSession.type];

  if (!myMembership) {
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
          <p className="font-body-md text-body-md text-on-surface-variant">
            {t("notYetMemberBody")}
          </p>
          <div className="w-full max-w-xs">
            <JoinButton tontineSessionId={id} label={t("requestToJoin")} lang={lang} />
          </div>
        </section>
      </main>
    );
  }

  if (myMembership.status === "PENDING") {
    return (
      <main className="px-container-padding py-stack-gap-lg max-w-3xl lg:max-w-5xl mx-auto w-full">
        <section className="bg-surface rounded-xl p-6 shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant text-center flex flex-col items-center gap-2">
          <span className="material-symbols-outlined text-primary text-4xl">hourglass_top</span>
          <h1 className="font-title-md text-title-md text-primary">{t("approvalPending")}</h1>
          <p className="font-body-md text-body-md text-on-surface-variant">
            {t("approvalPendingBody", { session: sessionLabel })}
          </p>
        </section>
      </main>
    );
  }

  if (myMembership.status === "REJECTED") {
    return (
      <main className="px-container-padding py-stack-gap-lg max-w-3xl lg:max-w-5xl mx-auto w-full">
        <section className="bg-surface rounded-xl p-6 shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant text-center flex flex-col items-center gap-3">
          <span className="material-symbols-outlined text-error text-4xl">cancel</span>
          <h1 className="font-title-md text-title-md text-error">{t("requestRejectedTitle")}</h1>
          <p className="font-body-md text-body-md text-on-surface-variant">
            {t("requestRejectedBody", { session: sessionLabel })}
          </p>
          <div className="w-full max-w-xs">
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
          <p className="font-body-md text-body-md text-on-surface-variant">
            {t("selectYourSlotsBody", { session: sessionLabel })}
          </p>
        </section>
        <SelectSlotsForm tontineSessionId={id} lang={lang} />
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
        prisma.contribution.findMany({ where: { membershipSlotId: { in: allSlotIds }, dueDate } }),
        prisma.fine.findMany({ where: { membershipSlotId: { in: allSlotIds }, dueDate, status: "UNPAID" } }),
      ])
    : [[], []];

  const contributionBySlot = new Map(contributions.map((c) => [c.membershipSlotId, c]));
  const fineBySlot = new Map(fines.map((f) => [f.membershipSlotId, f]));

  const allSlotsFlat = approvedMemberships.flatMap((m) =>
    m.slots.map((s) => ({ ...s, member: m.user, isMine: m.userId === userId })),
  );
  const paidCount = allSlotsFlat.filter((s) => contributionBySlot.get(s.id)?.status === "PAID").length;

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
          beneficiaryName={`${paidContribution.membershipSlot.membership.user.name} — ${paidContribution.membershipSlot.beneficiaryName}`}
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
      <section className="mb-stack-gap-lg bg-surface rounded-xl p-5 shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant">
        <div className="flex justify-between items-start mb-4">
          <div>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-secondary-container/20 text-on-secondary-container font-label-sm text-label-sm uppercase tracking-wider mb-2">
              {t(sessionStatusKey(tontineSession.status))}
            </span>
            <h1 className="text-xl md:text-2xl font-bold text-on-surface">{sessionLabel}</h1>
            <p className="font-body-md text-body-md text-on-surface-variant flex items-center gap-1 mt-1">
              <span className="material-symbols-outlined text-sm">event</span>
              {t("contributionStartDateLabel")}:{" "}
              {tontineSession.startDate.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-GB", {
                timeZone: "Africa/Douala",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </p>
            <p className="font-body-md text-body-md text-on-surface-variant flex items-center gap-1 mt-1">
              <span className="material-symbols-outlined text-sm">schedule</span>
              {t("deadlineLabel")}: {tontineSession.limitTime}
            </p>
          </div>
          <div className="text-right">
            <div className="font-label-md text-label-md text-on-surface-variant mb-1">{t("totalRegisteredSlots")}</div>
            <div className="font-numeric-data text-numeric-data text-primary">
              {totalRegisteredSlots}
              {tontineSession.maxSlots ? ` / ${Number(tontineSession.maxSlots)}` : ""}
            </div>
          </div>
        </div>
        <div className="mt-5 pt-4 border-t border-surface-variant flex items-center justify-between">
          <div className="font-label-sm text-label-sm text-on-surface-variant">
            {paidCount}/{allSlotsFlat.length} {t("slotsPaidThisCycle")}
          </div>
          <div className="w-24 h-2 bg-surface-variant rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full"
              style={{ width: `${allSlotsFlat.length ? (paidCount / allSlotsFlat.length) * 100 : 0}%` }}
            />
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-surface-variant flex items-center justify-end flex-wrap gap-2">
          <PayoutOrderModal tontineSessionId={id} lang={lang} />
        </div>
      </section>

      {tontineSession.status !== "ACTIVE" && tontineSession.status !== "CLOSED" && (
        <div className="mb-stack-gap-lg flex items-start gap-2 bg-secondary-container/15 text-on-secondary-container rounded-xl p-4 border border-secondary-fixed-dim/30">
          <span className="material-symbols-outlined text-[20px] flex-shrink-0 mt-0.5">info</span>
          <p className="font-body-md text-body-md">{t("paymentsAvailableAfterDraw")}</p>
        </div>
      )}

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

      <SwapRequestPanel
        tontineSessionId={id}
        currentUserId={userId}
        myPosition={myPosition}
        coMembers={coMembers}
        pendingRequests={pendingSwapRequests}
        lang={lang}
      />

      <div className="lg:grid lg:grid-cols-2 lg:gap-6 lg:items-start">
      <section className="mb-stack-gap-lg lg:mb-0">
        <h2 className="font-title-md text-title-md text-on-surface mb-stack-gap-md px-1 flex items-center gap-2">
          {t("yourSlots")}
        </h2>
        <div className="bg-surface rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant overflow-hidden">
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
            const notReadyForPayment = tontineSession.status !== "ACTIVE" || s.officialPosition === null;
            return (
              <div
                key={s.id}
                className={`flex items-center p-4 ${index < mySlots.length - 1 ? "border-b border-surface-variant" : ""}`}
              >
                <div className="flex-grow min-w-0">
                  <div className="font-label-md text-label-md text-on-surface truncate">{s.beneficiaryName}</div>
                  <div className="font-label-sm text-label-sm text-on-surface-variant">
                    {t("positionLabel")} {s.ballDrawn ?? t("notYetRevealed")} ·{" "}
                    {paid ? t("paid") : `${formatXAF(slotTotal)} ${t("due")}`}
                  </div>
                  {slotDateLabel && (
                    <div className="font-label-sm text-[11px] text-on-surface-variant flex items-center gap-1 mt-0.5">
                      <span className="material-symbols-outlined text-[13px]">event</span>
                      {t("estimatedDateLabel")}: {slotDateLabel}
                    </div>
                  )}
                </div>
                {!paid && (
                  <PayButton
                    membershipSlotId={s.id}
                    beneficiaryName={s.beneficiaryName}
                    amountLabel={formatXAF(slotTotal)}
                    description={paymentDescription}
                    defaultPhone={myMembership.user.phone}
                    lang={lang}
                    lockedReason={
                      notReadyForPayment
                        ? (s.officialPosition === null ? t("positionsNotYetAssigned") : t("paymentsAvailableAfterDraw"))
                        : !roundLock.ok && currentBeneficiaryName
                          ? t("paymentsLockedUntilPayout", { name: currentBeneficiaryName })
                          : undefined
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="font-title-md text-title-md text-on-surface mb-stack-gap-md px-1">{t("memberStatus")}</h2>
        <div className="bg-surface rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant overflow-hidden">
          {allSlotsFlat.map((s, index) => {
            const c = contributionBySlot.get(s.id);
            const f = fineBySlot.get(s.id);
            const paid = c?.status === "PAID";
            const slotDateLabel = s.officialPosition
              ? getCycleDateForRound(tontineSession.type, tontineSession.startDate, s.officialPosition).toLocaleDateString(
                  lang === "fr" ? "fr-FR" : "en-GB",
                  { timeZone: "Africa/Douala", day: "numeric", month: "short", year: "numeric" },
                )
              : null;
            return (
              <div
                key={s.id}
                className={`flex items-center p-4 ${index < allSlotsFlat.length - 1 ? "border-b border-surface-variant" : ""} ${s.isMine ? "bg-primary/5" : ""}`}
              >
                <div className="font-label-md text-label-md text-on-surface-variant w-8 text-center mr-2">
                  {s.ballDrawn ?? "—"}
                </div>
                <div className="w-10 h-10 rounded-full bg-surface-variant text-on-surface-variant flex items-center justify-center font-label-md text-label-md mr-4 overflow-hidden">
                  {s.member.avatar || s.member.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.member.avatar ?? s.member.image!} alt={s.member.name} className="w-full h-full object-cover" />
                  ) : (
                    s.member.name.slice(0, 2).toUpperCase()
                  )}
                </div>
                <div className="flex-grow min-w-0">
                  <div className="font-label-md text-label-md text-on-surface truncate">{s.beneficiaryName}</div>
                  <div className="font-label-sm text-label-sm text-on-surface-variant truncate">
                    {s.member.name}
                    {paid
                      ? ` · ${c?.paidAt ? t("paidAtLabel", { time: c.paidAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) }) : t("paid")}`
                      : ` · ${t("notYetPaid")}`}
                  </div>
                  <div className="font-label-sm text-[11px] text-on-surface-variant truncate">
                    {slotDateLabel ? `${t("estimatedDateLabel")}: ${slotDateLabel}` : t("positionNotYetAssignedShort")}
                  </div>
                </div>
                <div className="text-right">
                  <span
                    className={
                      paid
                        ? "inline-flex items-center px-2 py-1 rounded-md bg-[#d1fae5] text-[#065f46] font-label-sm text-label-sm"
                        : f
                          ? "inline-flex items-center px-2 py-1 rounded-md bg-error-container text-on-error-container font-label-sm text-label-sm"
                          : "inline-flex items-center px-2 py-1 rounded-md bg-secondary-fixed text-on-secondary-fixed-variant font-label-sm text-label-sm"
                    }
                  >
                    {paid ? t("paid") : f ? t("late") : t("pending")}
                  </span>
                  {f && (
                    <div className="font-label-sm text-label-sm text-error mt-1">
                      +{formatXAF(Number(f.amount))} {t("fineSuffix")}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
      </div>
    </main>
  );
}
