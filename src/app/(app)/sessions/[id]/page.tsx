import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getContributionTotal, getNextDueDate } from "@/lib/tontine-engine";
import { PayButton } from "./pay-button";
import { JoinButton } from "./join-button";

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

  const tontineSession = await prisma.tontineSession.findUnique({
    where: { id },
    include: {
      memberships: {
        include: { user: { select: { id: true, name: true, avatar: true, image: true } } },
        orderBy: [{ officialPosition: "asc" }, { ballDrawn: "asc" }],
      },
    },
  });
  if (!tontineSession) notFound();

  const myMembership = tontineSession.memberships.find((m) => m.userId === userId);

  if (!myMembership) {
    return (
      <main className="px-container-padding py-stack-gap-lg max-w-3xl mx-auto">
        <section className="bg-surface rounded-xl p-6 shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant text-center flex flex-col items-center gap-3">
          <span className="material-symbols-outlined text-primary text-4xl">groups</span>
          <h1 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface">
            {TONTINE_LABELS[tontineSession.type]}
          </h1>
          <p className="font-body-md text-body-md text-on-surface-variant">
            You&rsquo;re not a member of this tontine yet. Request to join and an admin will review
            your request.
          </p>
          <div className="w-full max-w-xs">
            <JoinButton tontineSessionId={id} label="Request to Join" />
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
          <h1 className="font-title-md text-title-md text-primary">Approval Pending</h1>
          <p className="font-body-md text-body-md text-on-surface-variant">
            Your request to join {TONTINE_LABELS[tontineSession.type]} is awaiting admin approval.
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
          <h1 className="font-title-md text-title-md text-error">Request Rejected</h1>
          <p className="font-body-md text-body-md text-on-surface-variant">
            Your request to join {TONTINE_LABELS[tontineSession.type]} was not approved. You can
            submit a new request below.
          </p>
          <div className="w-full max-w-xs">
            <JoinButton tontineSessionId={id} label="Request Again" />
          </div>
        </section>
      </main>
    );
  }

  const approvedMemberships = tontineSession.memberships.filter((m) => m.status === "APPROVED");

  const now = new Date();
  const dueDate = getNextDueDate(tontineSession.type, now);
  const { total } = getContributionTotal(tontineSession.type);

  const [contributions, fines] = await Promise.all([
    prisma.contribution.findMany({
      where: { tontineSessionId: id, dueDate },
    }),
    prisma.fine.findMany({
      where: { tontineSessionId: id, dueDate, status: "UNPAID" },
    }),
  ]);

  const contributionByUser = new Map(contributions.map((c) => [c.userId, c]));
  const fineByUser = new Map(fines.map((f) => [f.userId, f]));

  const myContribution = contributionByUser.get(userId);
  const myFine = fineByUser.get(userId);
  const alreadyPaid = myContribution?.status === "PAID";
  const myTotal = total + (myFine ? Number(myFine.amount) : 0);

  const paidCount = approvedMemberships.filter(
    (m) => contributionByUser.get(m.userId)?.status === "PAID",
  ).length;

  return (
    <main className="px-container-padding py-stack-gap-lg max-w-3xl mx-auto pb-32">
      <section className="mb-stack-gap-lg bg-surface rounded-xl p-5 shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant">
        <div className="flex justify-between items-start mb-4">
          <div>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-secondary-container/20 text-on-secondary-container font-label-sm text-label-sm uppercase tracking-wider mb-2">
              {tontineSession.status}
            </span>
            <h1 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface">
              {TONTINE_LABELS[tontineSession.type]}
            </h1>
            <p className="font-body-md text-body-md text-on-surface-variant flex items-center gap-1 mt-1">
              <span className="material-symbols-outlined text-sm">schedule</span>
              Deadline: {tontineSession.limitTime}
            </p>
          </div>
          <div className="text-right">
            <div className="font-label-md text-label-md text-on-surface-variant mb-1">Your Total</div>
            <div className="font-numeric-data text-numeric-data text-primary">
              {myTotal.toLocaleString("en-US")} F
            </div>
          </div>
        </div>
        <div className="mt-5 pt-4 border-t border-surface-variant flex items-center justify-between">
          <div className="font-label-sm text-label-sm text-on-surface-variant">
            {paidCount}/{approvedMemberships.length} paid this cycle
          </div>
          <div className="w-24 h-2 bg-surface-variant rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full"
              style={{
                width: `${approvedMemberships.length ? (paidCount / approvedMemberships.length) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      </section>

      {tontineSession.status === "DRAWING" && !myMembership.ballDrawn && (
        <Link
          href={`/sessions/${id}/draw`}
          className="mb-stack-gap-lg flex items-center justify-between bg-primary text-on-primary rounded-xl p-4 shadow-md hover:opacity-90 transition-opacity"
        >
          <span className="font-label-md text-label-md">Draw your lucky ball for this cycle</span>
          <span className="material-symbols-outlined">casino</span>
        </Link>
      )}

      <section>
        <h2 className="font-title-md text-title-md text-on-surface mb-stack-gap-md px-1">Member Status</h2>
        <div className="bg-surface rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant overflow-hidden">
          {approvedMemberships.map((m, index) => {
            const c = contributionByUser.get(m.userId);
            const f = fineByUser.get(m.userId);
            const paid = c?.status === "PAID";
            return (
              <div
                key={m.id}
                className={`flex items-center p-4 ${index < approvedMemberships.length - 1 ? "border-b border-surface-variant" : ""} ${m.userId === userId ? "bg-primary/5" : ""}`}
              >
                <div className="font-label-md text-label-md text-on-surface-variant w-8 text-center mr-2">
                  {m.officialPosition ?? "—"}
                </div>
                <div className="w-10 h-10 rounded-full bg-surface-variant text-on-surface-variant flex items-center justify-center font-label-md text-label-md mr-4 overflow-hidden">
                  {m.user.avatar || m.user.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.user.avatar ?? m.user.image!} alt={m.user.name} className="w-full h-full object-cover" />
                  ) : (
                    m.user.name.slice(0, 2).toUpperCase()
                  )}
                </div>
                <div className="flex-grow min-w-0">
                  <div className="font-label-md text-label-md text-on-surface truncate">{m.user.name}</div>
                  <div className="font-label-sm text-label-sm text-on-surface-variant">
                    {paid ? `Paid${c?.paidAt ? ` at ${c.paidAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""}` : "Not yet paid"}
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
                    {paid ? "Paid" : f ? "Late" : "Pending"}
                  </span>
                  {f && (
                    <div className="font-label-sm text-label-sm text-error mt-1">
                      +{Number(f.amount).toLocaleString("en-US")} F fine
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {!alreadyPaid && (
        <PayButton
          tontineSessionId={id}
          amountLabel={`${myTotal.toLocaleString("en-US")} F`}
        />
      )}
    </main>
  );
}
