import { getFallbackPaymentConfig } from "@/lib/fallback-payment-config";
import type { MobileMoneyProvider } from "@/generated/prisma/enums";

export type FinancialDirection = "IN" | "OUT";

export interface ServiceAvailabilityCheckResult {
  allowed: boolean;
  message?: string;
}

const DEFAULT_UNAVAILABLE_MESSAGE =
  "Ce service est momentanément indisponible. Veuillez choisir un autre moyen de paiement ou réessayer ultérieurement.";

/**
 * Checks whether a Mobile Money operator (Orange Money or MTN MoMo) is available
 * for a specific financial flow direction:
 * - "IN" (Entrées : recharges de portefeuille, versements de cotisations, remboursements de prêts)
 * - "OUT" (Sorties : retraits de portefeuille, décaissements de cagnottes/payouts)
 *
 * Governed by admin toggles in Centralized Financial System Availability Control.
 */
export async function checkFinancialServiceAvailability(options: {
  provider: MobileMoneyProvider;
  direction: FinancialDirection;
}): Promise<ServiceAvailabilityCheckResult> {
  const config = await getFallbackPaymentConfig();
  const { provider, direction } = options;

  if (provider === "ORANGE") {
    // Check legacy global suspension first
    if (config.isOrangeSuspended) {
      return {
        allowed: false,
        message: config.orangeSuspendedReason || DEFAULT_UNAVAILABLE_MESSAGE,
      };
    }

    if (direction === "IN") {
      const enabled = config.orangeCashInEnabled ?? true;
      if (!enabled) {
        return {
          allowed: false,
          message:
            config.orangeCashInDisabledReason ||
            "Les dépôts et paiements Orange Money sont momentanément indisponibles. Veuillez choisir un autre moyen de paiement ou réessayer ultérieurement.",
        };
      }
    } else {
      const enabled = config.orangeCashOutEnabled ?? true;
      if (!enabled) {
        return {
          allowed: false,
          message:
            config.orangeCashOutDisabledReason ||
            "Les retraits et décaissements Orange Money sont momentanément indisponibles. Veuillez choisir un autre moyen de paiement ou réessayer ultérieurement.",
        };
      }
    }
  } else if (provider === "MTN") {
    // Check legacy global suspension first
    if (config.isMtnSuspended) {
      return {
        allowed: false,
        message: config.mtnSuspendedReason || DEFAULT_UNAVAILABLE_MESSAGE,
      };
    }

    if (direction === "IN") {
      const enabled = config.mtnCashInEnabled ?? true;
      if (!enabled) {
        return {
          allowed: false,
          message:
            config.mtnCashInDisabledReason ||
            "Les dépôts et paiements MTN Mobile Money sont momentanément indisponibles. Veuillez choisir un autre moyen de paiement ou réessayer ultérieurement.",
        };
      }
    } else {
      const enabled = config.mtnCashOutEnabled ?? true;
      if (!enabled) {
        return {
          allowed: false,
          message:
            config.mtnCashOutDisabledReason ||
            "Les retraits et décaissements MTN Mobile Money sont momentanément indisponibles. Veuillez choisir un autre moyen de paiement ou réessayer ultérieurement.",
        };
      }
    }
  }

  return { allowed: true };
}
