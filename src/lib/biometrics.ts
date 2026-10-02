/**
 * Client-side WebAuthn Biometric Authentication helper for DIVA Association.
 * Directly triggers device native biometrics: Face ID, Touch ID, Android Fingerprint.
 * Requires NO PIN code and NO passwords.
 */

export type BiometricType = "face_id" | "touch_id" | "fingerprint";

export const STORAGE_ENABLED = "diva_biometric_lock_enabled";
export const STORAGE_CRED_ID = "diva_biometric_cred_id";
export const SESSION_UNLOCKED = "diva_biometric_session_unlocked";
export const STORAGE_LAST_ACTIVE = "diva_biometric_last_active";

function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function base64UrlToUint8Array(base64url: string): Uint8Array {
  let base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function isPlatformBiometricAvailable(): Promise<boolean> {
  if (typeof window === "undefined" || !window.PublicKeyCredential) return false;
  try {
    if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === "function") {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    }
  } catch (err) {
    console.warn("[biometrics] check failed:", err);
  }
  return true;
}

export function detectBiometricType(): BiometricType {
  if (typeof navigator === "undefined") return "fingerprint";
  const ua = navigator.userAgent || "";
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isMacTouch = /Macintosh/i.test(ua) && typeof document !== "undefined" && "ontouchend" in document;

  if (isIOS || isMacTouch) {
    // iPhone X and later have screen height >= 812 and use Face ID
    if (typeof window !== "undefined" && window.screen.height >= 812) {
      return "face_id";
    }
    return "touch_id";
  }

  return "fingerprint";
}

export function isBiometricLockEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(STORAGE_ENABLED) === "true";
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

/**
 * Register device biometric authenticator (Face ID / Fingerprint) in 1 tap without PIN code.
 */
export async function registerBiometrics(userName: string = "Membre"): Promise<{ success: boolean; error?: string }> {
  if (typeof window === "undefined" || !window.PublicKeyCredential) {
    return { success: false, error: "La biométrie n'est pas supportée par ce navigateur." };
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
          name: userName || "membre",
          displayName: userName || "Membre DIVA",
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },  // ES256
          { type: "public-key", alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform", // Direct device biometric sensor
          userVerification: "required",        // Direct Fingerprint / Face ID prompt
          residentKey: "preferred",
        },
        timeout: 60000,
        attestation: "none",
      },
    })) as PublicKeyCredential | null;

    if (!credential) {
      return { success: false, error: "Scan biométrique annulé." };
    }

    const rawId = new Uint8Array(credential.rawId);
    const credIdBase64 = uint8ArrayToBase64Url(rawId);

    localStorage.setItem(STORAGE_CRED_ID, credIdBase64);
    localStorage.setItem(STORAGE_ENABLED, "true");
    setSessionUnlocked(true);

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[biometrics] register error:", err);
    if (message.includes("timed out") || message.includes("not allowed")) {
      return { success: false, error: "Scan biométrique annulé." };
    }
    return { success: false, error: message };
  }
}

/**
 * Authenticate directly with biometric (Face ID / Fingerprint / Touch ID).
 */
export async function authenticateWithBiometrics(): Promise<{ success: boolean; error?: string }> {
  if (typeof window === "undefined" || !window.PublicKeyCredential) {
    return { success: false, error: "Biométrie non disponible sur ce navigateur." };
  }

  try {
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    const credId = localStorage.getItem(STORAGE_CRED_ID);

    let allowCredentials: PublicKeyCredentialDescriptor[] | undefined;
    if (credId) {
      try {
        allowCredentials = [
          {
            type: "public-key",
            id: base64UrlToUint8Array(credId) as BufferSource,
            transports: ["internal"],
          },
        ];
      } catch {
        // Continue without allowCredentials filter
      }
    }

    const options: CredentialRequestOptions = {
      publicKey: {
        challenge,
        timeout: 60000,
        userVerification: "required", // Prompts device Face ID or Fingerprint
        rpId: window.location.hostname,
        ...(allowCredentials ? { allowCredentials } : {}),
      },
    };

    const assertion = await navigator.credentials.get(options);
    if (!assertion) {
      return { success: false, error: "Scan biométrique annulé." };
    }

    setSessionUnlocked(true);
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[biometrics] auth error:", err);
    if (message.includes("timed out") || message.includes("not allowed")) {
      return { success: false, error: "Scan biométrique annulé ou non reconnu." };
    }
    return { success: false, error: message };
  }
}

/**
 * Disable biometric lock completely in 1 tap without any code.
 */
export function disableBiometricLock() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_ENABLED);
  localStorage.removeItem(STORAGE_CRED_ID);
  localStorage.removeItem(STORAGE_LAST_ACTIVE);
  sessionStorage.removeItem(SESSION_UNLOCKED);
}
