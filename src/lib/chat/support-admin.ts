import { prisma } from "@/lib/prisma";

/**
 * The single admin surfaced to every non-admin member as their "Admin
 * Support" chat contact. There's no multi-admin routing in this app today —
 * whichever ADMIN row comes back first is who members reach, consistently,
 * for both the contact list and the support auto-reply bot. Falls back to a
 * PRESIDENT account so support still works if the only admin-tier account
 * has been promoted to President.
 */
export async function getSupportAdmin() {
  return (
    (await prisma.user.findFirst({
      where: { role: "ADMIN" },
      select: { id: true, name: true, avatar: true, image: true },
    })) ??
    prisma.user.findFirst({
      where: { role: "PRESIDENT" },
      select: { id: true, name: true, avatar: true, image: true },
    })
  );
}
