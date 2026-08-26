import { randomInt } from "crypto";
import { prisma } from "@/lib/prisma";

// Excludes visually ambiguous characters (0/O, 1/I/L) so a code read aloud
// or handwritten stays unambiguous.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function randomSegment(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
}

function candidateCode(): string {
  return `DIVA-${randomSegment(4)}-${randomSegment(4)}`;
}

/**
 * Generates a fresh, collision-checked member code. Retries on the rare
 * unique-constraint collision rather than trusting randomness alone.
 */
export async function generateUniqueMemberCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = candidateCode();
    const existing = await prisma.user.findUnique({ where: { memberCode: code }, select: { id: true } });
    if (!existing) return code;
  }
  throw new Error("Could not generate a unique member code after 10 attempts");
}

/**
 * Idempotent — only assigns a code the first time any of a user's
 * memberships is approved. Safe to call on every approval without
 * re-checking the caller side.
 */
export async function ensureMemberCode(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { memberCode: true } });
  if (user?.memberCode) return user.memberCode;

  const code = await generateUniqueMemberCode();
  const updated = await prisma.user.update({ where: { id: userId }, data: { memberCode: code } });
  return updated.memberCode!;
}
