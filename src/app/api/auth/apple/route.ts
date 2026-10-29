import { NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase-admin";
import { prisma } from "@/lib/prisma";
import { ensureMemberCode } from "@/lib/member-code";

/**
 * Route API /api/auth/apple
 *
 * Vérifie l'authenticité de l'idToken émis par Firebase / Apple,
 * gère l'upsert et le lien de compte pour éviter tout doublon d'utilisateur,
 * et accepte explicitement les adresses relais privées @privaterelay.appleid.com.
 */
export async function POST(request: Request) {
  try {
    const adminAuth = getAdminAuth();
    if (!adminAuth) {
      return NextResponse.json(
        { error: "Le service Firebase Admin n'est pas encore configuré sur ce serveur (clés manquantes)." },
        { status: 503 },
      );
    }

    const body = await request.json().catch(() => null);
    const { idToken, email: clientEmail, displayName: clientDisplayName } = body || {};

    if (!idToken || typeof idToken !== "string") {
      return NextResponse.json(
        { error: "Le jeton d'authentification (idToken) est manquant." },
        { status: 400 },
      );
    }

    // 1. Vérification cryptographique du jeton auprès de Firebase Admin
    let decodedToken;
    try {
      decodedToken = await adminAuth.verifyIdToken(idToken);
    } catch (verifyErr: any) {
      console.error("[api/auth/apple] Erreur de vérification du jeton Firebase:", verifyErr);
      return NextResponse.json(
        { error: "Jeton d'authentification invalide ou expiré." },
        { status: 401 },
      );
    }

    const firebaseUid = decodedToken.uid;

    // 2. Résolution de l'adresse email
    // RÈGLE CRITIQUE : Apple ne transmet l'email et le nom que lors de la TOUTE PREMIÈRE
    // connexion. Lors des connexions ultérieures, ces champs sont absents du token.
    let resolvedEmail = (decodedToken.email || clientEmail || "").trim().toLowerCase();

    // Si l'email n'est pas fourni dans le jeton, on le cherche en BDD via le providerAccountId
    if (!resolvedEmail) {
      const existingAccount = await prisma.account.findUnique({
        where: {
          provider_providerAccountId: {
            provider: "apple",
            providerAccountId: firebaseUid,
          },
        },
        include: {
          user: true,
        },
      });

      if (existingAccount?.user?.email) {
        resolvedEmail = existingAccount.user.email.toLowerCase();
      } else {
        // Dernière tentative : interroger directement Firebase Auth
        try {
          const firebaseUser = await adminAuth.getUser(firebaseUid);
          if (firebaseUser.email) {
            resolvedEmail = firebaseUser.email.toLowerCase();
          }
        } catch {
          // Ignorer
        }
      }
    }

    if (!resolvedEmail) {
      return NextResponse.json(
        {
          error:
            "Impossible d'obtenir l'adresse email depuis Apple. Veuillez autoriser l'accès à l'email lors de la connexion.",
        },
        { status: 400 },
      );
    }

    // RÈGLE CRITIQUE : Accepter explicitement @privaterelay.appleid.com
    // Il s'agit des adresses générées par "Masquer mon adresse e-mail" d'Apple.
    // Elles ne doivent EN AUCUN CAS être refusées ou traitées comme jetables.
    const isAppleRelay = resolvedEmail.endsWith("@privaterelay.appleid.com");
    if (isAppleRelay) {
      console.log("[api/auth/apple] Email Apple Private Relay détecté et accepté :", resolvedEmail);
    }

    const displayName =
      (clientDisplayName || decodedToken.name || "").trim() ||
      (isAppleRelay ? "Utilisateur Apple" : resolvedEmail.split("@")[0] || "Membre Apple");

    // 3. Recherche ou création (Upsert / Link) pour éviter TOUT doublon
    // Recherche de l'utilisateur par son email existant
    let user = await prisma.user.findUnique({
      where: { email: resolvedEmail },
    });

    if (user?.isBanned) {
      return NextResponse.json(
        { error: "Ce compte a été suspendu par l'association." },
        { status: 403 },
      );
    }

    if (!user) {
      // Création du nouvel utilisateur
      user = await prisma.user.create({
        data: {
          email: resolvedEmail,
          name: displayName,
          image: decodedToken.picture || null,
          emailVerified: new Date(),
        },
      });

      // Génération du code membre permanent (DIVAxxxx)
      await ensureMemberCode(user.id);
    } else {
      // L'utilisateur existe déjà : mise à jour douce si des données manquaient
      if (!user.emailVerified) {
        await prisma.user.update({
          where: { id: user.id },
          data: { emailVerified: new Date() },
        });
      }
    }

    // 4. Lier le compte Apple (Account) à l'utilisateur s'il n'est pas encore lié
    await prisma.account.upsert({
      where: {
        provider_providerAccountId: {
          provider: "apple",
          providerAccountId: firebaseUid,
        },
      },
      update: {
        id_token: idToken,
      },
      create: {
        userId: user.id,
        type: "oauth",
        provider: "apple",
        providerAccountId: firebaseUid,
        id_token: idToken,
      },
    });

    return NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });
  } catch (error: any) {
    console.error("[api/auth/apple] Erreur inattendue :", error);
    return NextResponse.json(
      { error: error?.message || "Une erreur est survenue lors de l'authentification avec Apple." },
      { status: 500 },
    );
  }
}
