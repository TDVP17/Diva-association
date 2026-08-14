import { prisma } from "@/lib/prisma";
import type { TontineSession } from "@/generated/prisma/client";
import type { TontineType } from "@/generated/prisma/enums";
import { isContributionDay, toDueDateKey } from "@/lib/tontine-engine";

const ALL_TONTINE_TYPES: TontineType[] = ["HEBDO_SUNDAY", "MONTHLY_25", "MONTHLY_28"];

/** Active sessions whose type has a contribution due today (Cameroon local time). */
export async function getActiveSessionsDueToday(
  now: Date,
): Promise<Array<{ tontineSession: TontineSession; dueDate: Date }>> {
  const results: Array<{ tontineSession: TontineSession; dueDate: Date }> = [];

  for (const type of ALL_TONTINE_TYPES) {
    if (!isContributionDay(type, now)) continue;
    const dueDate = toDueDateKey(now);
    const sessions = await prisma.tontineSession.findMany({ where: { type, status: "ACTIVE" } });
    for (const tontineSession of sessions) {
      results.push({ tontineSession, dueDate });
    }
  }

  return results;
}

/** Members of `tontineSession` who have not paid for `dueDate` yet. */
export async function getUnpaidMembers(tontineSessionId: string, dueDate: Date) {
  const [memberships, paidContributions] = await Promise.all([
    prisma.membership.findMany({
      where: { tontineSessionId },
      include: { user: { select: { id: true, name: true, phone: true } } },
    }),
    prisma.contribution.findMany({
      where: { tontineSessionId, dueDate, status: "PAID" },
      select: { userId: true },
    }),
  ]);

  const paidUserIds = new Set(paidContributions.map((c) => c.userId));
  return memberships.filter((m) => !paidUserIds.has(m.userId));
}
