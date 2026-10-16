import crypto from "crypto";

const SIGNUP_SECRET = process.env.AUTH_SECRET || "diva_association_secret_token_2026";
const ALGORITHM = "aes-256-gcm";

function getEncryptionKey(): Buffer {
  return crypto.createHash("sha256").update(SIGNUP_SECRET).digest();
}

export interface SignupPendingData {
  fullName: string;
  email: string;
  password: string;
  code: string;
  expiresAt: number;
}

/**
 * Encrypts pending sign-up data into a secure, tamper-proof token using AES-256-GCM.
 * Only the server holding AUTH_SECRET can decrypt and verify it.
 */
export function createSignupToken(data: SignupPendingData): string {
  const iv = crypto.randomBytes(12);
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const text = JSON.stringify(data);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

/**
 * Decrypts and authenticates a sign-up token.
 * Returns null if the token has been tampered with or is invalid.
 */
export function verifySignupToken(token: string): SignupPendingData | null {
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length < 28) return null;
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const encrypted = raw.subarray(28);

    const key = getEncryptionKey();
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    return JSON.parse(decrypted) as SignupPendingData;
  } catch {
    return null;
  }
}
