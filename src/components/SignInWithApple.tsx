"use client";

import { useState } from "react";
import { OAuthProvider, signInWithPopup } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase";

interface SignInWithAppleProps {
  callbackUrl?: string;
  onSuccess?: () => void;
  onError?: (errorMessage: string) => void;
  className?: string;
  buttonText?: string;
}

/**
 * Bouton "Continuer avec Apple" officiel conforme aux Apple Human Interface Guidelines.
 *
 * Utilise Firebase Auth côté client avec OAuthProvider('apple.com'),
 * demande les scopes 'email' et 'name', puis transmet le token vérifié
 * au backend /api/auth/apple pour synchronisation en base de données.
 */
export function SignInWithApple({
  callbackUrl = "/dashboard",
  onSuccess,
  onError,
  className = "",
  buttonText = "Continuer avec Apple",
}: SignInWithAppleProps) {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleAppleSignIn() {
    setLoading(true);
    setErrorMsg(null);

    try {
      const auth = getFirebaseAuth();
      if (!auth) {
        throw new Error(
          "La configuration Firebase/Apple est en cours d'activation (clés d'API requises).",
        );
      }
      const provider = new OAuthProvider("apple.com");

      // Scopes demandés conformément aux directives Apple & Firebase
      provider.addScope("email");
      provider.addScope("name");

      provider.setCustomParameters({
        locale: "fr",
      });

      // 1. Déclenchement de la popup Apple Sign-In
      const result = await signInWithPopup(auth, provider);
      const user = result.user;

      // 2. Récupération du JWT ID Token sécurisé
      const idToken = await user.getIdToken();

      // Note : Apple ne renvoie l'email et le nom complet QUE lors de la première autorisation.
      // Firebase extrait ces informations dans le résultat.
      const credential = OAuthProvider.credentialFromResult(result);
      const rawEmail =
        user.email ||
        (result as any)._tokenResponse?.email ||
        null;

      const rawDisplayName =
        user.displayName ||
        [
          (result as any)._tokenResponse?.firstName,
          (result as any)._tokenResponse?.lastName,
        ]
          .filter(Boolean)
          .join(" ") ||
        null;

      // 3. Envoi au backend pour vérification cryptographique (firebase-admin) et upsert DB
      const res = await fetch("/api/auth/apple", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          idToken,
          email: rawEmail,
          displayName: rawDisplayName,
          appleCredential: credential ? { idToken: credential.idToken } : undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.error || "Échec de l'authentification auprès du serveur.");
      }

      if (onSuccess) {
        onSuccess();
      } else {
        window.location.href = callbackUrl;
      }
    } catch (err: any) {
      console.error("[SignInWithApple] Erreur:", err);
      let message = "Une erreur est survenue lors de la connexion avec Apple.";

      if (err.code === "auth/popup-closed-by-user") {
        message = "Connexion annulée : vous avez fermé la fenêtre Apple.";
      } else if (err.code === "auth/cancelled-popup-request") {
        message = "Une tentative de connexion était déjà en cours.";
      } else if (err.code === "auth/popup-blocked") {
        message = "La fenêtre popup a été bloquée par votre navigateur. Veuillez autoriser les fenêtres popups pour ce site.";
      } else if (err.code === "auth/account-exists-with-different-credential") {
        message = "Un compte existe déjà avec cette adresse email. Veuillez vous connecter avec votre méthode habituelle.";
      } else if (err.message) {
        message = err.message;
      }

      setErrorMsg(message);
      if (onError) onError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`w-full ${className}`}>
      {errorMsg && (
        <div
          role="alert"
          className="mb-2 p-2.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg text-center"
        >
          {errorMsg}
        </div>
      )}

      <button
        type="button"
        onClick={handleAppleSignIn}
        disabled={loading}
        className="w-full h-[46px] px-4 py-2.5 bg-black hover:bg-[#1a1a1a] active:bg-[#2a2a2a] text-white font-medium text-sm rounded-lg flex items-center justify-center gap-3 transition-all duration-150 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed select-none cursor-pointer"
        style={{
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Icons", "Helvetica Neue", Helvetica, Arial, sans-serif',
          letterSpacing: "-0.01em",
        }}
        aria-label="Continuer avec Apple"
      >
        {loading ? (
          <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        ) : (
          <svg
            className="w-4 h-4 fill-current mb-0.5"
            viewBox="0 0 170 170"
            aria-hidden="true"
          >
            <path d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.19-2.12-9.97-3.17-14.34-3.17-4.58 0-9.49 1.05-14.75 3.17-5.26 2.13-9.5 3.24-12.74 3.35-4.35.13-9.16-1.9-14.42-6.08-3.7-3.04-7.58-7.71-11.65-14-4.88-7.5-8.8-16.14-11.77-25.91-2.96-9.78-4.44-19.3-4.44-28.58 0-13.53 3.56-24.6 10.68-33.2 7.12-8.6 16.03-12.98 26.73-13.14 5.02 0 10.23 1.25 15.63 3.76 5.4 2.52 9.27 3.84 11.61 3.96 2.01-.12 5.92-1.44 11.73-3.96 5.81-2.51 10.9-3.71 15.27-3.6 10.88.52 19.67 4.54 26.36 12.06-9.52 5.77-14.18 13.79-13.98 24.06.2 8.04 3.27 14.88 9.22 20.52 5.95 5.64 12.83 8.78 20.65 9.42-1.74 5.34-3.8 10.5-6.19 15.48zM119.22 31.84c0-7.39 2.65-14.19 7.95-20.4 5.3-6.21 11.76-10.15 19.38-11.83.69 1.83 1.04 3.69 1.04 5.58 0 7.39-2.65 14.28-7.95 20.67-5.3 6.39-11.79 10.36-19.47 11.91-.32-1.83-.95-3.8-1.95-5.93z" />
          </svg>
        )}
        <span>{loading ? "Connexion en cours..." : buttonText}</span>
      </button>
    </div>
  );
}

export default SignInWithApple;
