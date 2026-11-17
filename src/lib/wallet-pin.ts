import crypto from "crypto";

/**
 * Threshold in FCFA:
 * - Strictly below 50,000 FCFA -> automatic instant Fapshi payout.
 * - 50,000 FCFA and above -> requires Admin approval before payout.
 */
export const AUTO_WITHDRAWAL_LIMIT_XAF = 50_000;

/**
 * Security lock duration after a phone number change: 48 hours.
 */
export const PHONE_CHANGE_LOCK_HOURS = 48;

export function isValidWalletPin(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

/**
 * Hashes a 4-digit PIN using scrypt with a random 16-byte salt.
 * Format: `scrypt$<hexSalt>$<hexDerivedKey>`
 */
export function hashWalletPin(pin: string): string {
  if (!isValidWalletPin(pin)) {
    throw new Error("Le code PIN doit contenir exactement 4 chiffres.");
  }
  const salt = crypto.randomBytes(16).toString("hex");
  const pepper = process.env.WALLET_PIN_PEPPER || process.env.NEXTAUTH_SECRET || "diva-asso-pin-v1";
  const derived = crypto.scryptSync(`${pin}:${pepper}`, salt, 32).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

/**
 * Constant-time verification of a 4-digit PIN against stored hash.
 */
export function verifyWalletPin(pin: string, storedHash: string | null | undefined): boolean {
  if (!storedHash || !isValidWalletPin(pin)) return false;
  const parts = storedHash.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, expectedHex] = parts;
  const pepper = process.env.WALLET_PIN_PEPPER || process.env.NEXTAUTH_SECRET || "diva-asso-pin-v1";
  const actualBuf = crypto.scryptSync(`${pin}:${pepper}`, salt, 32);
  const expectedBuf = Buffer.from(expectedHex, "hex");
  if (actualBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

/**
 * Checks whether the user is still inside the 48-hour withdrawal lock window
 * following a phone number change.
 */
export function getWithdrawalLockStatus(
  phoneChangedAt: Date | null | undefined,
  now: Date = new Date(),
): { isLocked: boolean; remainingHours: number; unlocksAt: Date | null } {
  if (!phoneChangedAt) {
    return { isLocked: false, remainingHours: 0, unlocksAt: null };
  }
  const lockMs = PHONE_CHANGE_LOCK_HOURS * 60 * 60 * 1000;
  const unlocksAt = new Date(phoneChangedAt.getTime() + lockMs);
  const remainingMs = unlocksAt.getTime() - now.getTime();
  if (remainingMs <= 0) {
    return { isLocked: false, remainingHours: 0, unlocksAt: null };
  }
  return {
    isLocked: true,
    remainingHours: Math.ceil(remainingMs / (60 * 60 * 1000)),
    unlocksAt,
  };
}

