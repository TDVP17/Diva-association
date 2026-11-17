import { describe, it, expect } from "vitest";
import {
  calculateLoanCeiling,
  computeLoanTerms,
  computeAccruedLoanPenalty,
  LOAN_RISK_TOLERANCE_XAF,
} from "@/lib/loans";
import {
  hashWalletPin,
  verifyWalletPin,
  isValidWalletPin,
  getWithdrawalLockStatus,
  AUTO_WITHDRAWAL_LIMIT_XAF,
  PHONE_CHANGE_LOCK_HOURS,
} from "@/lib/wallet-pin";

describe("Cahier des Charges — Pilier 2 : Prêts d'Urgence Garantis", () => {
  it("calcule le plafond exact : max(0, G - D) + 10 000 FCFA", () => {
    const res = calculateLoanCeiling({
      guaranteedFutureGainG: 100_000,
      remainingDebtD: 30_000,
      unpaidOutPublicSlotsCount: 1,
    });
    expect(res.netCollateral).toBe(70_000);
    expect(res.maxLoanAmount).toBe(70_000 + LOAN_RISK_TOLERANCE_XAF);
    expect(res.maxLoanAmount).toBe(80_000);
  });

  it("borne C_net à 0 quand la dette D dépasse le gain futur G, tout en appliquant la tolérance de 10 000 FCFA si au moins un nom reste à bouffer", () => {
    const res = calculateLoanCeiling({
      guaranteedFutureGainG: 20_000,
      remainingDebtD: 50_000,
      unpaidOutPublicSlotsCount: 1,
    });
    expect(res.netCollateral).toBe(-30_000);
    expect(res.maxLoanAmount).toBe(10_000);
  });

  it("retourne un plafond strictement égal à 0 FCFA si le membre a déjà bouffé tous ses noms", () => {
    const res = calculateLoanCeiling({
      guaranteedFutureGainG: 0,
      remainingDebtD: 40_000,
      unpaidOutPublicSlotsCount: 0,
    });
    expect(res.maxLoanAmount).toBe(0);
  });

  it("calcule 15% d'intérêts, 21 jours d'échéance et 2 jours de période de grâce (ex: 50 000 -> 57 500)", () => {
    const origin = new Date("2026-11-01T12:00:00.000Z");
    const terms = computeLoanTerms(50_000, origin);

    expect(terms.principal).toBe(50_000);
    expect(terms.interestAmount).toBe(7_500);
    expect(terms.totalDue).toBe(57_500);
    expect(terms.dueDate.toISOString()).toBe("2026-11-22T12:00:00.000Z");
    expect(terms.graceEndDate.toISOString()).toBe("2026-11-24T12:00:00.000Z");
  });

  it("n'applique aucune pénalité avant le 23e jour, puis +5% tous les 2 jours dès le 23e jour", () => {
    const origin = new Date("2026-11-01T12:00:00.000Z");
    const { graceEndDate } = computeLoanTerms(50_000, origin); // 2026-11-24T12:00:00Z

    // Day 20 (active)
    expect(
      computeAccruedLoanPenalty(50_000, graceEndDate, new Date("2026-11-21T12:00:00.000Z")),
    ).toEqual({ isOverdue: false, penaltySteps: 0, penaltyAmount: 0 });

    // Day 22 (inside 48h grace period)
    expect(
      computeAccruedLoanPenalty(50_000, graceEndDate, new Date("2026-11-23T12:00:00.000Z")),
    ).toEqual({ isOverdue: false, penaltySteps: 0, penaltyAmount: 0 });

    // Day 23 + 1 hour -> Step 1 (+5% = 2 500 FCFA)
    expect(
      computeAccruedLoanPenalty(50_000, graceEndDate, new Date("2026-11-24T13:00:00.000Z")),
    ).toEqual({ isOverdue: true, penaltySteps: 1, penaltyAmount: 2_500 });

    // Day 25 + 12 hours -> Step 2 (+10% = 5 000 FCFA)
    expect(
      computeAccruedLoanPenalty(50_000, graceEndDate, new Date("2026-11-27T00:00:00.000Z")),
    ).toEqual({ isOverdue: true, penaltySteps: 2, penaltyAmount: 5_000 });

    // Day 27 + 2 hours -> Step 3 (+15% = 7 500 FCFA)
    expect(
      computeAccruedLoanPenalty(50_000, graceEndDate, new Date("2026-11-28T14:00:00.000Z")),
    ).toEqual({ isOverdue: true, penaltySteps: 3, penaltyAmount: 7_500 });
  });
});

describe("Cahier des Charges — Pilier 4 : Sécurité Retraits (PIN, Lock 48h, Seuil 50 000 FCFA)", () => {
  it("valide le format du code PIN à 4 chiffres", () => {
    expect(isValidWalletPin("1234")).toBe(true);
    expect(isValidWalletPin("0000")).toBe(true);
    expect(isValidWalletPin("123")).toBe(false);
    expect(isValidWalletPin("12345")).toBe(false);
    expect(isValidWalletPin("12ab")).toBe(false);
  });

  it("hache et vérifie le code PIN de façon sécurisée et salée", () => {
    const hash1 = hashWalletPin("4829");
    const hash2 = hashWalletPin("4829");
    expect(hash1).not.toBe(hash2); // Random salt each time
    expect(verifyWalletPin("4829", hash1)).toBe(true);
    expect(verifyWalletPin("4829", hash2)).toBe(true);
    expect(verifyWalletPin("0000", hash1)).toBe(false);
    expect(verifyWalletPin("4829", null)).toBe(false);
  });

  it("applique le verrouillage anti-piratage de 48h après changement de numéro", () => {
    const changedAt = new Date("2026-11-10T10:00:00.000Z");
    const after10h = new Date("2026-11-10T20:00:00.000Z");
    const after49h = new Date("2026-11-12T11:00:00.000Z");

    const locked = getWithdrawalLockStatus(changedAt, after10h);
    expect(locked.isLocked).toBe(true);
    expect(locked.remainingHours).toBe(38);

    const unlocked = getWithdrawalLockStatus(changedAt, after49h);
    expect(unlocked.isLocked).toBe(false);
    expect(unlocked.remainingHours).toBe(0);

    expect(PHONE_CHANGE_LOCK_HOURS).toBe(48);
    expect(AUTO_WITHDRAWAL_LIMIT_XAF).toBe(50_000);
  });
});

