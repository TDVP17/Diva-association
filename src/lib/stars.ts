import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";

/**
 * Award +1 star (max 5) to members of a tontine session who completed
 * the entire cotisation cycle without having received any fines.
 *
 * Called automatically when a tontine session is marked CLOSED.
 */
export async function awardStarsForCompletedSession(
  sessionId: string,
  adminUser?: { id: string; role: Role },
  request?: Request
) {
  const session = await prisma.tontineSession.findUnique({
    where: { id: sessionId },
    include: {
      memberships: {
        where: { status: "APPROVED" },
        include: {
          user: { select: { id: true, name: true, stars: true } },
          slots: {
            include: {
              fines: { select: { id: true } },
            },
          },
        },
      },
    },
  });

  if (!session) return { updatedCount: 0, rewardedUsers: [] };

  const rewardedUsers: Array<{ id: string; name: string; oldStars: number; newStars: number }> = [];

  for (const m of session.memberships) {
    const totalFines = m.slots.reduce((acc, slot) => acc + (slot.fines?.length || 0), 0);
    // If the member had 0 fines during the entire session:
    if (totalFines === 0) {
      const currentStars = m.user.stars ?? 0;
      if (currentStars < 5) {
        const nextStars = currentStars + 1;
        await prisma.user.update({
          where: { id: m.user.id },
          data: { stars: nextStars },
        });

        rewardedUsers.push({
          id: m.user.id,
          name: m.user.name,
          oldStars: currentStars,
          newStars: nextStars,
        });

        if (adminUser) {
          await logAudit({
            actorId: adminUser.id,
            actorRole: adminUser.role,
            action: "user_stars_awarded_cycle_completed",
            targetType: "User",
            targetId: m.user.id,
            tontineSessionId: sessionId,
            metadata: {
              sessionTitle: session.title,
              oldStars: currentStars,
              newStars: nextStars,
              reason: "Cotisation terminée avec succès sans aucune amende",
            },
            request,
          });
        }
      }
    }
  }

  return { updatedCount: rewardedUsers.length, rewardedUsers };
}
