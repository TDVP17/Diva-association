export const PRIVATE_PLATFORM_FEE_RATE = 0.051; // 5.1% exact sur le total cotisé sur toute la période

export interface PrivatePlatformFeeResult {
  amountPerCycle: number;
  totalCycles: number;
  totalContributionObligation: number;
  platformFeeRate: number;
  platformFeeAmount: number;
}

/**
 * Calcule les frais de plateforme DIVA Asso pour une cotisation privée :
 * exactement 5,1 % du montant total qu'un participant doit cotiser sur toute la durée du cycle.
 *
 * Exemple : 2 500 FCFA × 10 cycles = 25 000 FCFA -> Frais plateforme = 1 275 FCFA (5,1 %).
 */
export function calculatePrivatePlatformFee(
  amountPerCycle: number,
  totalCycles: number,
): PrivatePlatformFeeResult {
  const cleanAmount = Math.max(0, Math.round(amountPerCycle));
  const cleanCycles = Math.max(1, Math.round(totalCycles));
  const totalContributionObligation = cleanAmount * cleanCycles;
  const platformFeeAmount = Math.round(totalContributionObligation * PRIVATE_PLATFORM_FEE_RATE);

  return {
    amountPerCycle: cleanAmount,
    totalCycles: cleanCycles,
    totalContributionObligation,
    platformFeeRate: PRIVATE_PLATFORM_FEE_RATE,
    platformFeeAmount,
  };
}

export interface AdditionalFeeSplitResult {
  additionalFee: number;
  payoutPercentage: number;
  toPayout: number;
  toCreatorWallet: number;
}

/**
 * Calcule la répartition du montant additionnel déclaré (ex: 100 FCFA/tour) selon le pourcentage choisi par le créateur (0% à 100%).
 * Exemple : 100 FCFA à 50 % -> 50 FCFA dans la bouffe du bénéficiaire + 50 FCFA dans le portefeuille du créateur.
 */
export function calculateAdditionalFeeSplit(
  additionalFee: number,
  payoutPercentage: number,
): AdditionalFeeSplitResult {
  const cleanFee = Math.max(0, Math.round(additionalFee));
  const clampedPct = Math.max(0, Math.min(100, Math.round(payoutPercentage)));
  const toPayout = Math.round((cleanFee * clampedPct) / 100);
  const toCreatorWallet = cleanFee - toPayout;

  return {
    additionalFee: cleanFee,
    payoutPercentage: clampedPct,
    toPayout,
    toCreatorWallet,
  };
}

export interface PenaltySplitResult {
  penaltyAmount: number;
  beneficiaryPercentage: number;
  toDelayedBeneficiary: number;
  toRemainingRecipient: number;
}

/**
 * Calcule la répartition d'une amende de retard PAYÉE :
 * - Cotisation publique : 50 % au bénéficiaire retardé, 50 % à la caisse publique.
 * - Cotisation privée : selon le pourcentage (0 à 100 %) configuré par le créateur (le reste va au portefeuille du créateur).
 */
export function calculatePenaltySplit(
  penaltyAmount: number,
  beneficiaryPercentage: number,
): PenaltySplitResult {
  const cleanPenalty = Math.max(0, Math.round(penaltyAmount));
  const clampedPct = Math.max(0, Math.min(100, Math.round(beneficiaryPercentage)));
  const toDelayedBeneficiary = Math.round((cleanPenalty * clampedPct) / 100);
  const toRemainingRecipient = cleanPenalty - toDelayedBeneficiary;

  return {
    penaltyAmount: cleanPenalty,
    beneficiaryPercentage: clampedPct,
    toDelayedBeneficiary,
    toRemainingRecipient,
  };
}

export interface PrivateLaunchReadiness {
  minParticipants: number;
  approvedMembersCount: number;
  minimumReached: boolean;
  startDateApproachingOrArrived: boolean;
  canLaunch: boolean;
  statusLabel: string;
}

/**
 * Distingue l'atteinte du nombre minimal de participants de l'éligibilité réelle au lancement
 * (le lancement n'est autorisé que lorsque le minimum est atteint ET que la date de démarrage approche ou est arrivée).
 */
export function evaluatePrivateLaunchReadiness(params: {
  approvedMembersCount: number;
  minParticipants: number;
  startDate: Date;
  now?: Date;
}): PrivateLaunchReadiness {
  const now = params.now ?? new Date();
  const minP = Math.max(2, params.minParticipants);
  const minimumReached = params.approvedMembersCount >= minP;
  // Date de démarrage considérée comme approchante dans les 7 jours précédant la date prévue ou dépassée
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const startDateApproachingOrArrived = params.startDate.getTime() - now.getTime() <= sevenDaysMs;
  const canLaunch = minimumReached && startDateApproachingOrArrived;

  let statusLabel: string;
  if (!minimumReached) {
    statusLabel = `En attente de participants (${params.approvedMembersCount} / ${minP})`;
  } else if (!startDateApproachingOrArrived) {
    statusLabel = `Minimum atteint (${params.approvedMembersCount} / ${minP}) — En attente de la date de démarrage`;
  } else {
    statusLabel = `Minimum atteint (${params.approvedMembersCount} / ${minP}) — Prêt pour le lancement`;
  }

  return {
    minParticipants: minP,
    approvedMembersCount: params.approvedMembersCount,
    minimumReached,
    startDateApproachingOrArrived,
    canLaunch,
    statusLabel,
  };
}

