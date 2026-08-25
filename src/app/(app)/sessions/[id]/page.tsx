import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getContributionTotal, getNextDueDate } from "@/lib/tontine-engine";
import { getLang, getTranslator } from "@/lib/i18n/get-lang";
import { PayButton } from "./pay-button";
import { JoinButton } from "./join-button";
import { VerificationPollingRefresh } from "./verification-status";
import { SelectSlotsForm } from "./select-slots-form";

const TONTINE_LABELS: Record<string, string> = {
  HEBDO_SUNDAY: "Weekly Tontine (Sunday)",
  MONTHLY_28: "Monthly Tontine (28th)",
  MONTHLY_25: "Monthly Tontine (25th)",
};

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const userId = session!.user.id;
  const lang = await getLang();
  const t = getTranslator(lang);

  const tontineSession = await prisma.tontineSession.findUnique({
    where: { id },
    include: {
      memberships: {
        include: {
          user: { select: { id: true, name: true, avatar: true, image: true } },
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
        <main className="px-container-padding py-stack-gap-lg max-w-3xl mx-auto">
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
        <main className="px-container-padding py-stack-gap-lg max-w-3xl mx-auto">
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
      <main className="px-container-padding py-stack-gap-lg max-w-3xl mx-auto">
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
      <main className="px-container-padding py-stack-gap-lg max-w-3xl mx-auto">
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
      <main className="px-container-padding py-stack-gap-lg max-w-3xl mx-auto">
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
      <main className="px-container-padding py-stack-gap-lg max-w-3xl mx-auto">
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

  const mySlots = myMembership.slots;
  const myUndrawnSlots = mySlots.filter((s) => s.ballDrawn === null);

  return (
    <main className="px-container-padding py-stack-gap-lg max-w-3xl mx-auto pb-32">
      <section className="mb-stack-gap-lg bg-surface rounded-xl p-5 shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant">
        <div className="flex justify-between items-start mb-4">
          <div>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-secondary-container/20 text-on-secondary-container font-label-sm text-label-sm uppercase tracking-wider mb-2">
              {tontineSession.status}
            </span>
            <h1 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface">
              {sessionLabel}
            </h1>
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
        <div className="mt-4 pt-4 border-t border-surface-variant">
          <Link
            href={`/pay/${id}`}
            className="font-label-sm text-label-sm text-primary underline flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[16px]">share</span>
            {t("shareContributionLink")}
          </Link>
        </div>
      </section>

      {tontineSession.status === "DRAWING" && myUndrawnSlots.length > 0 && (
        <Link
          href={`/sessions/${id}/draw`}
          className="mb-stack-gap-lg flex items-center justify-between bg-primary text-on-primary rounded-xl p-4 shadow-md hover:opacity-90 transition-opacity"
        >
          <span className="font-label-md text-label-md">{t("drawYourBall")}</span>
          <span className="material-symbols-outlined">casino</span>
        </Link>
      )}

      <section className="mb-stack-gap-lg">
        <h2 className="font-title-md text-title-md text-on-surface mb-stack-gap-md px-1">{t("yourSlots")}</h2>
        <div className="bg-surface rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant overflow-hidden">
          {mySlots.map((s, index) => {
            const c = contributionBySlot.get(s.id);
            const f = fineBySlot.get(s.id);
            const paid = c?.status === "PAID";
            const slotTotal = perSlotTotal + (f ? Number(f.amount) : 0);
            return (
              <div
                key={s.id}
                className={`flex items-center p-4 ${index < mySlots.length - 1 ? "border-b border-surface-variant" : ""}`}
              >
                <div className="flex-grow min-w-0">
                  <div className="font-label-md text-label-md text-on-surface truncate">{s.beneficiaryName}</div>
                  <div className="font-label-sm text-label-sm text-on-surface-variant">
                    {t("positionLabel")} {s.officialPosition ?? "—"} · {paid ? t("paid") : `${slotTotal.toLocaleString("en-US")} F ${t("due")}`}
                  </div>
                </div>
                {!paid && <PayButton membershipSlotId={s.id} amountLabel={`${slotTotal.toLocaleString("en-US")} F`} />}
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
            return (
              <div
                key={s.id}
                className={`flex items-center p-4 ${index < allSlotsFlat.length - 1 ? "border-b border-surface-variant" : ""} ${s.isMine ? "bg-primary/5" : ""}`}
              >
                <div className="font-label-md text-label-md text-on-surface-variant w-8 text-center mr-2">
                  {s.officialPosition ?? "—"}
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
                  <div className="font-label-sm text-label-sm text-on-surface-variant">
                    {s.member.name}
                    {paid
                      ? ` · ${c?.paidAt ? t("paidAtLabel", { time: c.paidAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) }) : t("paid")}`
                      : ` · ${t("notYetPaid")}`}
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
                      +{Number(f.amount).toLocaleString("en-US")} F {t("fineSuffix")}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
