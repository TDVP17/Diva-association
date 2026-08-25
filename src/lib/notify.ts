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

/** Slots under `tontineSession`'s approved memberships that have not paid for `dueDate` yet. */
export async function getUnpaidSlots(tontineSessionId: string, dueDate: Date) {
  const memberships = await prisma.membership.findMany({
    where: { tontineSessionId, status: "APPROVED" },
    include: {
      user: { select: { id: true, name: true, phone: true } },
      slots: {
        include: { contributions: { where: { dueDate }, select: { status: true } } },
      },
    },
  });

  return memberships.flatMap((m) =>
    m.slots
      .filter((s) => s.contributions[0]?.status !== "PAID")
      .map((s) => ({ slotId: s.id, beneficiaryName: s.beneficiaryName, userId: m.userId, user: m.user })),
  );
}
