import { prisma } from "@/lib/prisma";

export const PRIVATE_TONTINE_RULES_ID = "private_tontine_rules";

export const DEFAULT_PRIVATE_TONTINE_RULES = `RÈGLEMENT OFFICIEL DES COTISATIONS PRIVÉES — DIVA ASSO

1. Responsabilité du Gestionnaire (Propriétaire) :
Le créateur d'une cotisation privée est entièrement responsable de la sélection, de la moralité et du suivi des membres qu'il invite dans son cercle fermé.

2. Validation préalable par DIVA Asso :
Toute nouvelle cotisation privée doit obligatoirement être vérifiée et validée par l'administration DIVA Asso avant la génération du lien d'invitation et l'ouverture aux membres.

3. Compte DIVA Asso obligatoire :
Chaque personne invitée via le lien sécurisé doit obligatoirement créer et posséder un compte vérifié sur DIVA Asso avant de pouvoir intégrer la cotisation privée.

4. Frais de gestion (5,1 %) :
Les transactions liées aux cotisations privées incluent des frais de 5,1 % (3,1 % frais opérateur + 2 % frais de plateforme DIVA Asso).

5. Isolation financière :
Les cotisations privées sont strictement indépendantes de la caisse publique DIVA Asso et ne donnent pas accès aux prêts d'urgence de la caisse publique.

6. Respect de la conformité :
DIVA Asso se réserve le droit de suspendre toute cotisation privée ne respectant pas la loi ou les présentes règles.`;

export async function getPrivateTontineRules(): Promise<{
  content: string;
  updatedAt: string | null;
}> {
  try {
    const row = await prisma.associationRules.findUnique({
      where: { id: PRIVATE_TONTINE_RULES_ID },
    });
    if (row && row.content.trim().length > 0) {
      return {
        content: row.content,
        updatedAt: row.updatedAt.toISOString(),
      };
    }
  } catch (err) {
    console.error("[getPrivateTontineRules] fallback to default:", err);
  }
  return {
    content: DEFAULT_PRIVATE_TONTINE_RULES,
    updatedAt: null,
  };
}

