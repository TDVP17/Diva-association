import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getContributionTotal } from "@/lib/tontine-engine";

const TONTINE_LABELS: Record<string, string> = {
  HEBDO_SUNDAY: "Weekly Tontine (Sunday)",
  MONTHLY_28: "Monthly Tontine (28th)",
  MONTHLY_25: "Monthly Tontine (25th)",
};

export default async function DashboardPage() {
  const session = await auth();
  const userId = session!.user.id;

  const [memberships, unpaidFines] = await Promise.all([
    prisma.membership.findMany({
      where: { userId, tontineSession: { status: { in: ["DRAWING", "ACTIVE"] } } },
      include: { tontineSession: true },
      orderBy: { joinedAt: "asc" },
    }),
    prisma.fine.aggregate({
      where: { userId, status: "UNPAID" },
      _sum: { amount: true },
    }),
  ]);

  const totalFines = Number(unpaidFines._sum.amount ?? 0);

  return (
    <main className="px-container-padding py-stack-gap-lg flex flex-col gap-stack-gap-lg max-w-3xl mx-auto">
      <section>
        <h2 className="font-title-md text-title-md text-primary mb-stack-gap-md">Your Tontines</h2>
        {memberships.length === 0 ? (
          <div className="bg-white rounded-xl p-6 text-center shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant">
            <p className="font-body-md text-body-md text-on-surface-variant">
              You&rsquo;re not part of any active tontine session yet.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-stack-gap-md">
            {memberships.map((m) => {
              const { amount, fee } = getContributionTotal(m.tontineSession.type);
              return (
                <Link
                  key={m.id}
                  href={`/sessions/${m.tontineSession.id}`}
                  className="bg-white rounded-xl p-4 shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant flex items-center justify-between hover:bg-surface-container-low transition-colors"
                >
                  <div>
                    <h3 className="font-label-md text-label-md text-primary uppercase tracking-wide">
                      {TONTINE_LABELS[m.tontineSession.type]}
                    </h3>
                    <p className="font-numeric-data text-numeric-data text-on-surface">
                      {amount.toLocaleString("en-US")}{" "}
                      <span className="font-body-md text-body-md font-normal text-on-surface-variant">F</span>
                    </p>
                    <p className="font-label-sm text-label-sm text-on-surface-variant">
                      +{fee.toLocaleString("en-US")} F fee &middot; {m.tontineSession.status}
                    </p>
                  </div>
                  <span className="material-symbols-outlined text-outline">chevron_right</span>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section className="grid grid-cols-2 gap-stack-gap-md">
        <div className="bg-white rounded-xl p-4 shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border-l-4 border-error">
          <span className="material-symbols-outlined text-error mb-2">warning</span>
          <h4 className="font-label-sm text-label-sm text-on-surface-variant mb-1">Unpaid Fines</h4>
          <p className="font-numeric-data text-numeric-data text-error">
            {totalFines.toLocaleString("en-US")}{" "}
            <span className="font-body-md text-body-md font-normal">F</span>
          </p>
        </div>
        <Link
          href="/chat"
          className="bg-white rounded-xl p-4 shadow-[0px_4px_20px_rgba(30,41,59,0.05)] flex flex-col justify-between hover:bg-surface-container-low transition-colors"
        >
          <span className="material-symbols-outlined text-primary mb-2">chat_bubble</span>
          <h4 className="font-label-sm text-label-sm text-on-surface-variant mb-1">Messages</h4>
          <p className="font-label-md text-label-md text-on-surface">Open Chat</p>
        </Link>
      </section>
    </main>
  );
}
