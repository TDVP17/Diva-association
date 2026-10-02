/**
 * Client-side WebAuthn Biometric Authentication helper for DIVA Association.
 * Supports Face ID, Touch ID, Android Biometrics (Fingerprint/Face Unlock),
 * Windows Hello, and platform authenticators with PIN backup.
 */

export type BiometricType = "face_id" | "touch_id" | "fingerprint" | "generic";

const STORAGE_ENABLED = "diva_biometric_lock_enabled";
const STORAGE_CRED_ID = "diva_biometric_cred_id";
const STORAGE_PIN_HASH = "diva_biometric_pin_hash";
const SESSION_UNLOCKED = "diva_biometric_session_unlocked";
const STORAGE_LAST_ACTIVE = "diva_biometric_last_active";

export async function isPlatformBiometricAvailable(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!window.PublicKeyCredential) return false;
  try {
    if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === "function") {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    }
  } catch (err) {
    console.warn("[biometrics] check failed:", err);
  }
  return false;
}

export function detectBiometricType(): BiometricType {
  if (typeof navigator === "undefined") return "generic";
  const ua = navigator.userAgent || "";
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const isMac = /Macintosh/i.test(ua);

  if (isIOS) {
    // iPhones from X onwards (window.screen.height >= 812) typically use Face ID
    if (typeof window !== "undefined" && window.screen.height >= 812) {
      return "face_id";
    }
    return "touch_id";
  }

  if (isAndroid) {
    return "fingerprint";
  }

  if (isMac) {
    return "touch_id";
  }

  return "generic";
}

export function isBiometricLockEnabled(): boolean {
  return false;
}

export function isSessionUnlocked(): boolean {
  if (typeof window === "undefined") return true;
  return sessionStorage.getItem(SESSION_UNLOCKED) === "true";
}

export function setSessionUnlocked(unlocked: boolean) {
  if (typeof window === "undefined") return;
  if (unlocked) {
    sessionStorage.setItem(SESSION_UNLOCKED, "true");
    localStorage.setItem(STORAGE_LAST_ACTIVE, String(Date.now()));
  } else {
    sessionStorage.removeItem(SESSION_UNLOCKED);
  }
}

export function getLastActiveTimestamp(): number {
  if (typeof window === "undefined") return 0;
  return Number(localStorage.getItem(STORAGE_LAST_ACTIVE) || "0");
}

export function touchLastActive() {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_LAST_ACTIVE, String(Date.now()));
}

async function sha256(str: string): Promise<string> {
  const enc = new TextEncoder();
  const hash = await crypto.subtle.digest("SHA-256", enc.encode(str));
  const bytes = new Uint8Array(hash);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function setBackupPin(pin: string): Promise<void> {
  if (typeof window === "undefined") return;
  const hash = await sha256(pin);
  localStorage.setItem(STORAGE_PIN_HASH, hash);
}

export async function verifyBackupPin(pin: string): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const stored = localStorage.getItem(STORAGE_PIN_HASH);
  if (!stored) return false;
  const hash = await sha256(pin);
  return hash === stored;
}

export function hasBackupPin(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(localStorage.getItem(STORAGE_PIN_HASH));
}

/**
 * Register device biometric authenticator using WebAuthn Platform Authenticator.
 */
export async function registerBiometrics(userName: string): Promise<{ success: boolean; error?: string }> {
  if (typeof window === "undefined" || !window.PublicKeyCredential) {
    return { success: false, error: "WebAuthn unsupported" };
  }

  try {
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    const userIdBytes = new Uint8Array(16);
    crypto.getRandomValues(userIdBytes);

    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: {
          name: "DIVA Association",
          id: window.location.hostname,
        },
        user: {
          id: userIdBytes,
          name: userName || "diva_member",
          displayName: userName || "Membre DIVA",
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 }, // ES256
          { type: "public-key", alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
          requireResidentKey: false,
        },
        timeout: 60000,
        attestation: "none",
      },
    })) as PublicKeyCredential | null;

    if (!credential) {
      return { success: false, error: "Création d'empreinte annulée" };
    }

    localStorage.setItem(STORAGE_CRED_ID, credential.id);
    localStorage.setItem(STORAGE_ENABLED, "true");
    setSessionUnlocked(true);

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[biometrics] register error:", err);
    return { success: false, error: message };
  }
}

/**
 * Authenticate with biometric (Face ID / Fingerprint / Touch ID).
 */
export async function authenticateWithBiometrics(): Promise<{ success: boolean; error?: string }> {
  if (typeof window === "undefined" || !window.PublicKeyCredential) {
    return { success: false, error: "Biométrie non disponible" };
  }

  try {
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    const credId = localStorage.getItem(STORAGE_CRED_ID);

    const options: CredentialRequestOptions = {
      publicKey: {
        challenge,
        timeout: 60000,
        userVerification: "required",
        rpId: window.location.hostname,
        ...(credId
          ? {
              allowCredentials: [
                {
                  type: "public-key",
                  id: Uint8Array.from(atob(credId.replace(/_/g, "/").replace(/-/g, "+")), (c) => c.charCodeAt(0)),
                },
              ],
            }
          : {}),
      },
    };

    const assertion = await navigator.credentials.get(options);
    if (!assertion) {
      return { success: false, error: "Authentification annulée" };
    }

    setSessionUnlocked(true);
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[biometrics] auth error:", err);
    return { success: false, error: message };
  }
}

/**
 * Disable biometric lock completely.
 */
export function disableBiometricLock() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_ENABLED);
  localStorage.removeItem(STORAGE_CRED_ID);
  localStorage.removeItem(STORAGE_PIN_HASH);
  localStorage.removeItem(STORAGE_LAST_ACTIVE);
  sessionStorage.removeItem(SESSION_UNLOCKED);
}
