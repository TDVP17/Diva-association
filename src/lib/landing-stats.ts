import { prisma } from "@/lib/prisma";

export interface PublicStats {
  memberCount: number;
  activeCotisationCount: number;
  totalContributionsTracked: number;
}

/**
 * Real, live-computed numbers for the public landing page's trust section —
 * deliberately never hardcoded/invented. Safe to expose pre-auth: only
 * aggregate counts, no personal data.
 */
export async function getPublicStats(): Promise<PublicStats> {
  // Sequential, not Promise.all — this is a public, unauthenticated route,
  // so it's better to trickle 3 queries one at a time than to open 3
  // connections at once against the pool.
  const memberCount = await prisma.user.count();
  const activeCotisationCount = await prisma.tontineSession.count({ where: { status: "ACTIVE" } });
  const contributionsAgg = await prisma.contribution.aggregate({
    where: { status: "PAID" },
    _sum: { amountPaid: true, feePaid: true },
  });

  const totalContributionsTracked =
    Number(contributionsAgg._sum.amountPaid ?? 0) + Number(contributionsAgg._sum.feePaid ?? 0);

  return { memberCount, activeCotisationCount, totalContributionsTracked };
}
