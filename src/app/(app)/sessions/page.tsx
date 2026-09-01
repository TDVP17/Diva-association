import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { assertJoinable, sumRegisteredSlots } from "@/lib/session-joinability";
import { getLang, getTranslator } from "@/lib/i18n/get-lang";

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
  const t = getTranslator(await getLang());

  const memberships = await prisma.membership.findMany({
    where: { userId },
    include: { tontineSession: true, slots: true },
    orderBy: { joinedAt: "desc" },
  });

  const candidates = await prisma.tontineSession.findMany({
    where: {
      status: { not: "CLOSED" },
      id: { notIn: memberships.map((m) => m.tontineSessionId) },
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

  return (
    <main className="px-container-padding py-stack-gap-lg max-w-3xl lg:max-w-6xl mx-auto w-full flex flex-col gap-section-margin">
      <section>
        <h2 className="sticky top-16 z-30 bg-background py-2 -mx-container-padding px-container-padding font-title-md text-title-md text-primary mb-stack-gap-md shadow-[0px_4px_20px_rgba(30,41,59,0.05)]">
          {t("mySessions")}
        </h2>
        {memberships.length === 0 ? (
          <div className="bg-white rounded-xl p-8 text-center shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant flex flex-col items-center gap-stack-gap-sm">
            <span className="material-symbols-outlined text-outline text-[40px]">group_add</span>
            <p className="font-body-md text-body-md text-on-surface-variant">{t("notJoinedYet")}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-stack-gap-md lg:grid lg:grid-cols-2 xl:grid-cols-3 lg:gap-stack-gap-md">
            {memberships.map((m) => (
              <Link
                key={m.id}
                href={`/sessions/${m.tontineSession.id}`}
                className="bg-white rounded-xl p-4 shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant flex items-center justify-between hover:bg-surface-container-low transition-colors"
              >
                <div>
                  <h3 className="font-label-md text-label-md text-on-surface">
                    {m.tontineSession.title || TONTINE_LABELS[m.tontineSession.type]}
                  </h3>
                  <p className="font-label-sm text-label-sm text-on-surface-variant">
                    {m.status === "APPROVED"
                      ? m.slotCount === null
                        ? t("selectSlotsToStart")
                        : `${m.slots.length} ${t("slotsRegistered")}`
                      : m.status === "PENDING"
                        ? t("awaitingApproval")
                        : t("requestRejected")}
                  </p>
                </div>
                <span
                  className={`font-label-sm text-label-sm px-2 py-1 rounded ${STATUS_STYLES[m.tontineSession.status]}`}
                >
                  {m.tontineSession.status}
                </span>
              </Link>
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
                  <p className="font-label-sm text-label-sm text-on-surface-variant">
                    {t("startsOn")} {s.startDate.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                  <p className="font-label-sm text-label-sm text-primary mt-0.5">
                    {t("validatedMembersCount", {
                      count: String(s.memberships.filter((m) => m.status === "APPROVED").length),
                    })}
                  </p>
                </div>
                <span className="material-symbols-outlined text-outline">chevron_right</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
