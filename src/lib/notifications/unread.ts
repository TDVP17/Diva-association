import { prisma } from "@/lib/prisma";

/**
 * Returns the exact unread notification count for the user's in-app feed,
 * filtering strictly to channel "IN_APP" and applying the same deduplication
 * logic as GET /api/notifications.
 *
 * This ensures the red badge number in the header matches exactly the number
 * of unread notification cards visible to the member.
 */
export async function getUnreadInAppNotificationCount(userId: string): Promise<number> {
  if (!userId || typeof prisma?.notification?.findMany !== "function") return 0;

  try {
    const notifications = await prisma.notification.findMany({
      where: {
        userId,
        channel: "IN_APP",
        status: { in: ["SENT", "FAILED"] },
        readAt: null,
      },
      select: {
        type: true,
        tontineSessionId: true,
        messageKey: true,
        message: true,
      },
    });

    const seen = new Set<string>();
    let count = 0;
    for (const n of notifications) {
      const key = `${n.type}-${n.tontineSessionId ?? "global"}-${n.messageKey ?? n.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        count++;
      }
    }
    return count;
  } catch (err) {
    console.error("[notifications/unread] failed to calculate unread count:", err);
    return 0;
  }
}
