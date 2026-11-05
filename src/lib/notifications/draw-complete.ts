import { prisma } from "@/lib/prisma";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";

/**
 * Checks if all slots in the session have completed the draw (all ballDrawn are set,
 * all officialPositions are assigned), and if so, sends a notification to all approved members
 * alerting them that everyone has their position and they can now contribute.
 *
 * Idempotent: checks if `drawCompletedReadyToContribute` was already scheduled for this session.
 * Delivery: In-App & Web Push are instant; Emails are staggered 3 minutes apart (STAGGER_MS)
 * to strictly prevent email spam flags.
 */
export async function notifyDrawCompletedIfAllDrawn(tontineSessionId: string): Promise<boolean> {
  const session = await prisma.tontineSession.findUnique({
    where: { id: tontineSessionId },
    include: {
      memberships: {
        where: { status: "APPROVED" },
        include: {
          slots: {
            select: { id: true, ballDrawn: true, officialPosition: true, beneficiaryName: true },
          },
        },
      },
    },
  });

  if (!session) return false;

  const allSlots = session.memberships.flatMap((m) => m.slots);
  if (allSlots.length === 0) return false;

  // Check if every slot has drawn their ball and has an official position
  const allDrawn = allSlots.every((s) => s.ballDrawn !== null && s.officialPosition !== null);
  if (!allDrawn) return false;

  // Idempotency: verify this event notification has not already been sent for this session
  const alreadySent = await prisma.notification.findFirst({
    where: {
      tontineSessionId,
      type: "CONTRIBUTION_REMINDER",
      messageKey: "drawCompletedReadyToContribute",
    },
    select: { id: true },
  });

  if (alreadySent) return false;

  // Automatically ensure session status is updated to ACTIVE
  if (session.status === "DRAWING") {
    await prisma.tontineSession.update({
      where: { id: tontineSessionId },
      data: { status: "ACTIVE" },
    }).catch(() => null);
  }

  const sessionTitle = session.title || "Cotisation";
  const userIds = Array.from(new Set(session.memberships.map((m) => m.userId)));

  if (userIds.length === 0) return false;

  await scheduleInAppNotifications({
    tontineSessionId,
    type: "CONTRIBUTION_REMINDER",
    recipients: userIds.map((userId) => ({
      userId,
      message: `Le tirage au sort est terminé et toutes les places de l'ordre de passage sont attribuées ! Vous pouvez dès à présent effectuer votre cotisation pour "${sessionTitle}".`,
      messageKey: "drawCompletedReadyToContribute",
      messageVars: { cotisation: sessionTitle },
      actionUrl: `/sessions/${tontineSessionId}`,
    })),
  });

  return true;
}
