import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const TONTINE_LABELS: Record<string, string> = {
  HEBDO_SUNDAY: "Weekly Tontine (Sunday)",
  MONTHLY_28: "Monthly Tontine (28th)",
  MONTHLY_25: "Monthly Tontine (25th)",
};

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-surface-container-high text-on-surface-variant",
  DRAWING: "bg-secondary-fixed-dim/20 text-on-secondary-fixed-variant",
  ACTIVE: "bg-primary/10 text-primary",
  CLOSED: "bg-surface-container-high text-on-surface-variant",
};

export default async function SessionsPage() {
  const session = await auth();
  const userId = session!.user.id;

  const memberships = await prisma.membership.findMany({
    where: { userId },
    include: { tontineSession: true },
    orderBy: { joinedAt: "desc" },
  });

  return (
    <main className="px-container-padding py-stack-gap-lg max-w-3xl mx-auto">
      <h2 className="font-title-md text-title-md text-primary mb-stack-gap-md">My Sessions</h2>
      {memberships.length === 0 ? (
        <div className="bg-white rounded-xl p-6 text-center shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant">
          <p className="font-body-md text-body-md text-on-surface-variant">
            You haven&rsquo;t joined a tontine session yet.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-stack-gap-md">
          {memberships.map((m) => (
            <Link
              key={m.id}
              href={`/sessions/${m.tontineSession.id}`}
              className="bg-white rounded-xl p-4 shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant flex items-center justify-between hover:bg-surface-container-low transition-colors"
            >
              <div>
                <h3 className="font-label-md text-label-md text-on-surface">
                  {TONTINE_LABELS[m.tontineSession.type]}
                </h3>
                <p className="font-label-sm text-label-sm text-on-surface-variant">
                  Position {m.officialPosition ?? "—"} &middot; Ball {m.ballDrawn ?? "not drawn"}
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
    </main>
  );
}
