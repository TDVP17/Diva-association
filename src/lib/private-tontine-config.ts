import { prisma } from "@/lib/prisma";

export const PRIVATE_TONTINE_CONFIG_ID = "private_tontine_config";

export interface PrivateTontineActionOption {
  key: string;
  label: string;
  description: string;
  enabledByAdmin: boolean;
  defaultSelected: boolean;
}

export interface PrivateTontineCreationConfig {
  minSlots: number;
  maxSlotsLimit: number;
  minAmount: number;
  maxAmount: number;
  actions: PrivateTontineActionOption[];
}

export const DEFAULT_PRIVATE_TONTINE_CONFIG: PrivateTontineCreationConfig = {
  minSlots: 2,
  maxSlotsLimit: 100,
  minAmount: 1_000,
  maxAmount: 5_000_000,
  actions: [
    {
      key: "allow_fines",
      label: "Amendes de retard",
      description: "Appliquer automatiquement une amende en cas de retard de paiement.",
      enabledByAdmin: true,
      defaultSelected: true,
    },
    {
      key: "allow_random_draw",
      label: "Tirage au sort aléatoire",
      description: "Permettre au propriétaire de lancer un tirage au sort automatique de l'ordre de bouffe.",
      enabledByAdmin: true,
      defaultSelected: true,
    },
    {
      key: "allow_manual_order",
      label: "Classement manuel de l'ordre de passage",
      description: "Permettre au propriétaire de définir ou réordonner manuellement l'ordre des tours.",
      enabledByAdmin: true,
      defaultSelected: true,
    },
    {
      key: "allow_announcements",
      label: "Annonces aux membres",
      description: "Envoyer des messages d'annonce à tous les participants de la cotisation privée.",
      enabledByAdmin: true,
      defaultSelected: true,
    },
    {
      key: "allow_wallet_auto",
      label: "Prélèvement automatique Portefeuille (J-1)",
      description: "Cotiser automatiquement la veille depuis le Portefeuille DIVA Asso si le solde est suffisant.",
      enabledByAdmin: true,
      defaultSelected: true,
    },
    {
      key: "allow_multi_slots",
      label: "Plusieurs noms par membre",
      description: "Autoriser un membre à prendre plusieurs places (noms) dans cette cotisation privée.",
      enabledByAdmin: true,
      defaultSelected: false,
    },
  ],
};

export async function getPrivateTontineConfig(): Promise<PrivateTontineCreationConfig> {
  try {
    const row = await prisma.associationRules.findUnique({
      where: { id: PRIVATE_TONTINE_CONFIG_ID },
      select: { content: true },
    });
    if (!row?.content) return DEFAULT_PRIVATE_TONTINE_CONFIG;
    const parsed = JSON.parse(row.content) as Partial<PrivateTontineCreationConfig>;
    return {
      minSlots:
        typeof parsed.minSlots === "number" && parsed.minSlots >= 2
          ? parsed.minSlots
          : DEFAULT_PRIVATE_TONTINE_CONFIG.minSlots,
      maxSlotsLimit:
        typeof parsed.maxSlotsLimit === "number" && parsed.maxSlotsLimit >= 2
          ? parsed.maxSlotsLimit
          : DEFAULT_PRIVATE_TONTINE_CONFIG.maxSlotsLimit,
      minAmount:
        typeof parsed.minAmount === "number" && parsed.minAmount >= 500
          ? parsed.minAmount
          : DEFAULT_PRIVATE_TONTINE_CONFIG.minAmount,
      maxAmount:
        typeof parsed.maxAmount === "number" && parsed.maxAmount >= 1000
          ? parsed.maxAmount
          : DEFAULT_PRIVATE_TONTINE_CONFIG.maxAmount,
      actions:
        Array.isArray(parsed.actions) && parsed.actions.length > 0
          ? parsed.actions
          : DEFAULT_PRIVATE_TONTINE_CONFIG.actions,
    };
  } catch {
    return DEFAULT_PRIVATE_TONTINE_CONFIG;
  }
}

export async function setPrivateTontineConfig(
  config: PrivateTontineCreationConfig,
  adminId: string,
): Promise<PrivateTontineCreationConfig> {
  await prisma.associationRules.upsert({
    where: { id: PRIVATE_TONTINE_CONFIG_ID },
    create: {
      id: PRIVATE_TONTINE_CONFIG_ID,
      content: JSON.stringify(config),
      updatedByAdminId: adminId,
    },
    update: {
      content: JSON.stringify(config),
      updatedByAdminId: adminId,
    },
  });
  return config;
}

