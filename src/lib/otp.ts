import { randomInt, createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import type { OtpPurpose } from "@/generated/prisma/enums";

const OTP_PEPPER = process.env.OTP_PEPPER ?? "";
const CODE_TTL_MS = 10 * 60 * 1000;
const REQUEST_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function hashOtp(code: string): string {
  return createHash("sha256").update(`${code}${OTP_PEPPER}`).digest("hex");
}

/**
 * Creates a new OTP challenge for the given user+purpose, unless one was
 * already requested within the cooldown window (returns null in that case
 * so the caller can avoid re-sending a WhatsApp message too often).
 */
export async function createOtpChallenge(
  userId: string,
  purpose: OtpPurpose,
  pendingValue: string | null,
): Promise<{ code: string } | null> {
  const recent = await prisma.otpChallenge.findFirst({
    where: { userId, purpose, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (recent && Date.now() - recent.createdAt.getTime() < REQUEST_COOLDOWN_MS) {
    return null;
  }

  const code = generateOtp();
  await prisma.otpChallenge.create({
    data: {
      userId,
      purpose,
      codeHash: hashOtp(code),
      pendingValue,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
  });
  return { code };
}

export type VerifyOtpResult =
  | { ok: true; pendingValue: string | null }
  | { ok: false; error: "not_found" | "expired" | "too_many_attempts" | "invalid_code" };

/** Verifies (and consumes, on success) the most recent unconsumed challenge for a user+purpose. */
export async function verifyOtp(userId: string, purpose: OtpPurpose, code: string): Promise<VerifyOtpResult> {
  const challenge = await prisma.otpChallenge.findFirst({
    where: { userId, purpose, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!challenge) return { ok: false, error: "not_found" };
  if (challenge.expiresAt < new Date()) return { ok: false, error: "expired" };
  if (challenge.attempts >= MAX_ATTEMPTS) return { ok: false, error: "too_many_attempts" };

  if (challenge.codeHash !== hashOtp(code)) {
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    });
    return { ok: false, error: "invalid_code" };
  }

  await prisma.otpChallenge.update({
    where: { id: challenge.id },
    data: { consumedAt: new Date() },
  });
  return { ok: true, pendingValue: challenge.pendingValue };
}

/**
 * Checks whether a fresh, consumed (verified) challenge exists for this
 * user+purpose+pendingValue — used by the profile server actions to confirm
 * an OTP was actually verified before applying the underlying change.
 * Consumed challenges are valid for reuse for a short window after
 * verification, matching the same TTL as the code itself.
 */
export async function hasVerifiedOtp(
  userId: string,
  purpose: OtpPurpose,
  pendingValue: string | null,
): Promise<boolean> {
  const challenge = await prisma.otpChallenge.findFirst({
    where: { userId, purpose, consumedAt: { not: null }, pendingValue },
    orderBy: { consumedAt: "desc" },
  });
  if (!challenge || !challenge.consumedAt) return false;
  return Date.now() - challenge.consumedAt.getTime() < CODE_TTL_MS;
}
