import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

/**
 * Initialisation sécurisée et paresseuse (lazy) du SDK Firebase Client.
 * NE plante JAMAIS l'application au chargement du module si les clés d'environnement
 * NEXT_PUBLIC_FIREBASE_* ne sont pas encore définies dans Vercel/Production.
 */
export function getFirebaseApp(): FirebaseApp | null {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) {
    return null;
  }

  if (getApps().length > 0) {
    return getApp();
  }

  try {
    return initializeApp({
      apiKey,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    });
  } catch (err) {
    console.warn("[Firebase] Erreur d'initialisation de l'application :", err);
    return null;
  }
}

export function getFirebaseAuth(): Auth | null {
  const app = getFirebaseApp();
  if (!app) return null;

  try {
    return getAuth(app);
  } catch (err) {
    console.warn("[Firebase] Erreur d'initialisation Auth :", err);
    return null;
  }
}
