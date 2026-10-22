import { prisma } from "@/lib/prisma";
import type { TontineSession } from "@/generated/prisma/client";
import { isContributionDay, toDueDateKey, ALL_TONTINE_TYPES } from "@/lib/tontine-engine";
import { getDesignatedSlot } from "@/lib/round-robin-lock";

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

/** Active sessions whose type has a contribution due tomorrow (Cameroon local time, J-1). */
export async function getActiveSessionsDueTomorrow(
  now: Date,
): Promise<Array<{ tontineSession: TontineSession; dueDate: Date }>> {
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const results: Array<{ tontineSession: TontineSession; dueDate: Date }> = [];

  for (const type of ALL_TONTINE_TYPES) {
    if (!isContributionDay(type, tomorrow)) continue;
    const dueDate = toDueDateKey(tomorrow);
    const sessions = await prisma.tontineSession.findMany({ where: { type, status: "ACTIVE" } });
    for (const tontineSession of sessions) {
      results.push({ tontineSession, dueDate });
    }
  }

  return results;
}

/**
 * Slots under `tontineSession`'s approved memberships that have not paid for `dueDate` yet.
 * Strictly filters out any slot whose contribution has already been PAID, as well as the
 * designated winner's slot which is exempt from contributing for their winning round.
 */
export async function getUnpaidSlots(tontineSessionId: string, dueDate: Date) {
  const [designatedSlot, memberships] = await Promise.all([
    getDesignatedSlot(tontineSessionId).catch(() => null),
    prisma.membership.findMany({
      where: { tontineSessionId, status: "APPROVED" },
      include: {
        user: { select: { id: true, name: true, phone: true, email: true, preferredLang: true } },
        slots: {
          include: { contributions: { where: { dueDate }, select: { status: true } } },
        },
      },
    }),
  ]);

  return (memberships ?? []).flatMap((m) =>
    (m.slots ?? [])
      .filter((s) => s.id !== designatedSlot?.id && s.contributions?.[0]?.status !== "PAID")
      .map((s) => ({ slotId: s.id, beneficiaryName: s.beneficiaryName, userId: m.userId, user: m.user })),
  );
}
