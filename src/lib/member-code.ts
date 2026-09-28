import { prisma } from "@/lib/prisma";

/**
 * Generates an 8-character sequential member code: "DIVA" followed by a 4-digit sequence number
 * (e.g. DIVA0001, DIVA0002, ..., DIVA0020).
 */
export async function generateUniqueMemberCode(): Promise<string> {
  const usersWithCode = await prisma.user.findMany({
    where: { memberCode: { startsWith: "DIVA" } },
    select: { memberCode: true },
  });

  let maxSeq = 0;
  for (const u of usersWithCode) {
    if (!u.memberCode) continue;
    const m = u.memberCode.match(/^DIVA(\d{4,})$/);
    if (m) {
      const num = parseInt(m[1], 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }

  for (let offset = 1; offset <= 50; offset++) {
    const candidate = `DIVA${String(maxSeq + offset).padStart(4, "0")}`;
    const exists = await prisma.user.findUnique({
      where: { memberCode: candidate },
      select: { id: true },
    });
    if (!exists) {
      return candidate;
    }
  }

  return `DIVA${String(maxSeq + 1).padStart(4, "0")}`;
}

/**
 * Idempotent — only assigns a code the first time any of a user's
 * memberships is approved. Safe to call on every approval without
 * re-checking the caller side.
 */
export async function ensureMemberCode(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { memberCode: true } });
  if (user?.memberCode && /^DIVA\d{4}$/.test(user.memberCode)) {
    return user.memberCode;
  }

  const code = await generateUniqueMemberCode();
  const updated = await prisma.user.update({ where: { id: userId }, data: { memberCode: code } });
  return updated.memberCode!;
}
