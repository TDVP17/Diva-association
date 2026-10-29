import { getApps, initializeApp, cert, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";

function getServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    try {
      return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    } catch {
      // ignore JSON parse error
    }
  }

  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (privateKey) {
    privateKey = privateKey.replace(/\\n/g, "\n");
  }

  if (projectId && clientEmail && privateKey) {
    return { projectId, clientEmail, privateKey };
  }

  return undefined;
}

export function getAdminApp(): App | null {
  if (getApps().length > 0) {
    return getApps()[0]!;
  }

  const serviceAccount = getServiceAccount();
  if (!serviceAccount) {
    return null;
  }

  try {
    return initializeApp({ credential: cert(serviceAccount) });
  } catch (err) {
    console.warn("[FirebaseAdmin] Erreur lors de l'initialisation de l'application Admin :", err);
    return null;
  }
}

export function getAdminAuth(): Auth | null {
  const app = getAdminApp();
  if (!app) return null;

  try {
    return getAuth(app);
  } catch (err) {
    console.warn("[FirebaseAdmin] Erreur lors de l'initialisation de Auth Admin :", err);
    return null;
  }
}
