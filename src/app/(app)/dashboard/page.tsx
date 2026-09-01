import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getContributionTotal } from "@/lib/tontine-engine";
import { getLang, getTranslator } from "@/lib/i18n/get-lang";
import { formatXAF } from "@/lib/format-currency";

const TONTINE_LABELS: Record<string, string> = {
  HEBDO_SUNDAY: "Weekly Tontine (Sunday)",
  MONTHLY_28: "Monthly Tontine (28th)",
  MONTHLY_25: "Monthly Tontine (25th)",
  BIWEEKLY_SUNDAY: "Every 2 Weeks (Sunday)",
  QUARTERLY_25: "Every 3 Months (25th)",
};

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const userId = session.user.id;
  const t = getTranslator(await getLang());

  const [memberships, unpaidFines] = await Promise.all([
    prisma.membership.findMany({
      where: {
        userId,
        status: "APPROVED",
        // Excludes only CLOSED — a DRAFT cotisation the member's already
        // been approved into (drawing hasn't started yet) still belongs on
        // the dashboard, it just isn't collecting contributions yet. This
        // used to require DRAWING/ACTIVE specifically, which is what made
        // an approved DRAFT membership vanish from the dashboard while
        // still showing up on the Cotisations page.
        tontineSession: { status: { not: "CLOSED" } },
      },
      include: { tontineSession: true },
      orderBy: { joinedAt: "asc" },
    }),
    prisma.fine.aggregate({
      where: { membershipSlot: { membership: { userId } }, status: "UNPAID" },
      _sum: { amount: true },
    }),
  ]);

  const totalFines = Number(unpaidFines._sum.amount ?? 0);

  return (
    <main className="px-container-padding py-stack-gap-lg flex flex-col gap-stack-gap-lg max-w-3xl lg:max-w-5xl mx-auto w-full">
      <section>
        <h2 className="sticky top-16 z-30 bg-background py-2 -mx-container-padding px-container-padding font-title-md text-title-md text-primary mb-stack-gap-md shadow-[0px_4px_20px_rgba(30,41,59,0.05)]">
          {t("yourTontines")}
        </h2>
        {memberships.length === 0 ? (
          <div className="bg-white rounded-xl p-8 text-center shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant flex flex-col items-center gap-stack-gap-sm">
            <span className="material-symbols-outlined text-outline text-[40px]">account_balance</span>
            <p className="font-body-md text-body-md text-on-surface-variant">{t("notInActiveTontine")}</p>
            <Link
              href="/sessions"
              className="mt-1 px-4 py-2 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 active:scale-95 transition-all"
            >
              {t("browseCotisations")}
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-stack-gap-md lg:grid lg:grid-cols-2 lg:gap-stack-gap-md">
            {memberships.map((m) => {
              const { amount, fee } = getContributionTotal({
                amount: Number(m.tontineSession.amount),
                fee: Number(m.tontineSession.fee),
              });
              return (
                <Link
                  key={m.id}
                  href={`/sessions/${m.tontineSession.id}`}
                  className="bg-white rounded-xl p-4 shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant flex items-center justify-between hover:bg-surface-container-low transition-colors"
                >
                  <div>
                    <h3 className="font-label-md text-label-md text-primary uppercase tracking-wide">
                      {m.tontineSession.title || TONTINE_LABELS[m.tontineSession.type]}
                    </h3>
                    <p className="font-numeric-data text-numeric-data text-on-surface">{formatXAF(amount)}</p>
                    <p className="font-label-sm text-label-sm text-on-surface-variant">
                      +{formatXAF(fee)} fee &middot; {m.tontineSession.status}
                    </p>
                  </div>
                  <span className="material-symbols-outlined text-outline">chevron_right</span>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {totalFines > 0 && (
        <Link
          href="/fines"
          className="bg-error-container/40 rounded-xl p-4 border border-error/30 flex items-center gap-3 hover:bg-error-container/60 transition-colors"
        >
          <span className="material-symbols-outlined text-error flex-shrink-0">warning</span>
          <div className="flex-1 min-w-0">
            <h4 className="font-label-sm text-label-sm text-on-error-container/80 mb-0.5">{t("unpaidFines")}</h4>
            <p className="font-numeric-data text-numeric-data text-error">
              {formatXAF(totalFines)}
            </p>
          </div>
          <span className="material-symbols-outlined text-error flex-shrink-0">chevron_right</span>
        </Link>
      )}

      <section>
        <h2 className="font-title-md text-title-md text-primary mb-stack-gap-md">{t("quickActions")}</h2>
        <Link
          href="/chat"
          className="bg-white rounded-xl p-4 shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant flex items-center gap-3 hover:bg-surface-container-low active:scale-[0.99] transition-all min-h-[44px]"
        >
          <span className="material-symbols-outlined text-primary flex-shrink-0">chat_bubble</span>
          <p className="font-label-md text-label-md text-on-surface flex-1">{t("openChat")}</p>
          <span className="material-symbols-outlined text-outline flex-shrink-0">chevron_right</span>
        </Link>
      </section>
    </main>
  );
}
