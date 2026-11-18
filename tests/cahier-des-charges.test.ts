import { describe, it, expect } from "vitest";
import {
  calculateLoanCeiling,
  buildSystemLoanOptions,
  computeLoanTerms,
  computeAccruedLoanPenalty,
  LOAN_RISK_TOLERANCE_XAF,
  LOAN_AUTO_APPROVAL_LIMIT_XAF,
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
  it("calcule le plafond exact : (G - D) + 10 000 FCFA quand le solde net acquis est strictement positif", () => {
    // Cas réel tilongvalentine2@gmail.com : 45 000 FCFA déjà cotisés sur 9 noms non bouffés, 0 nom bouffé
    const res = calculateLoanCeiling({
      guaranteedFutureGainG: 45_000,
      remainingDebtD: 0,
      unpaidOutPublicSlotsCount: 9,
    });
    expect(res.netCollateral).toBe(45_000);
    expect(res.bonusToleranceApplied).toBe(LOAN_RISK_TOLERANCE_XAF);
    expect(res.maxLoanAmount).toBe(55_000);
  });

  it("retourne 0 FCFA (sans ajouter les 10 000 FCFA) si le solde net C_net est nul ou négatif", () => {
    const negRes = calculateLoanCeiling({
      guaranteedFutureGainG: 20_000,
      remainingDebtD: 50_000,
      unpaidOutPublicSlotsCount: 1,
    });
    expect(negRes.netCollateral).toBe(-30_000);
    expect(negRes.bonusToleranceApplied).toBe(0);
    expect(negRes.maxLoanAmount).toBe(0);

    const zeroRes = calculateLoanCeiling({
      guaranteedFutureGainG: 0,
      remainingDebtD: 0,
      unpaidOutPublicSlotsCount: 2,
    });
    expect(zeroRes.bonusToleranceApplied).toBe(0);
    expect(zeroRes.maxLoanAmount).toBe(0);
  });

  it("retourne un plafond strictement égal à 0 FCFA si le membre a déjà bouffé tous ses noms", () => {
    const res = calculateLoanCeiling({
      guaranteedFutureGainG: 0,
      remainingDebtD: 40_000,
      unpaidOutPublicSlotsCount: 0,
    });
    expect(res.maxLoanAmount).toBe(0);
  });

  it("génère uniquement des paliers autorisés par le système ne dépassant jamais le plafond", () => {
    const opts = buildSystemLoanOptions(55_000);
    expect(opts.length).toBeGreaterThan(0);
    expect(opts[opts.length - 1]).toBe(55_000);
    for (const v of opts) {
      expect(v).toBeLessThanOrEqual(55_000);
    }
    expect(buildSystemLoanOptions(0)).toEqual([]);
  });

  it("applique le seuil Admin sur le total à rembourser : <= 50 000 FCFA automatique, > 50 000 FCFA validation Admin obligatoire", () => {
    expect(LOAN_AUTO_APPROVAL_LIMIT_XAF).toBe(50_000);

    // 40 000 + 6 000 (15%) + 800 (2% frais DIVA Asso) = 46 800 <= 50 000 -> auto
    const autoOk = computeLoanTerms(40_000);
    expect(autoOk.totalDue).toBe(46_800);
    expect(autoOk.requiresAdminApproval).toBe(false);

    // 50 000 + 7 500 (15%) + 1 000 (2% frais DIVA Asso) = 58 500 > 50 000 -> validation Admin obligatoire
    const needsAdmin = computeLoanTerms(50_000);
    expect(needsAdmin.divaFeeAmount).toBe(1_000);
    expect(needsAdmin.totalDue).toBe(58_500);
    expect(needsAdmin.requiresAdminApproval).toBe(true);
  });

  it("calcule 15% d'intérêts + 2% frais DIVA Asso, échéance à 18h00 Cameroun et 2 jours de grâce", () => {
    const origin = new Date("2026-11-01T12:00:00.000Z");
    const terms = computeLoanTerms(50_000, origin);

    expect(terms.principal).toBe(50_000);
    expect(terms.interestAmount).toBe(7_500);
    expect(terms.divaFeeAmount).toBe(1_000);
    expect(terms.totalDue).toBe(58_500);
    // 18h00 heure du Cameroun (UTC+1) === 17h00 UTC
    expect(terms.dueDate.toISOString()).toBe("2026-11-22T17:00:00.000Z");
    expect(terms.graceEndDate.toISOString()).toBe("2026-11-24T17:00:00.000Z");
  });

  it("n'applique aucune pénalité avant le 23e jour à 18h00, puis +5% tous les 2 jours ensuite", () => {
    const origin = new Date("2026-11-01T12:00:00.000Z");
    const { graceEndDate } = computeLoanTerms(50_000, origin);

    expect(
      computeAccruedLoanPenalty(50_000, graceEndDate, new Date("2026-11-21T12:00:00.000Z")),
    ).toEqual({ isOverdue: false, penaltySteps: 0, penaltyAmount: 0 });

    expect(
      computeAccruedLoanPenalty(50_000, graceEndDate, new Date("2026-11-24T16:59:00.000Z")),
    ).toEqual({ isOverdue: false, penaltySteps: 0, penaltyAmount: 0 });

    expect(
      computeAccruedLoanPenalty(50_000, graceEndDate, new Date("2026-11-24T18:00:00.000Z")),
    ).toEqual({ isOverdue: true, penaltySteps: 1, penaltyAmount: 2_500 });

    expect(
      computeAccruedLoanPenalty(50_000, graceEndDate, new Date("2026-11-27T00:00:00.000Z")),
    ).toEqual({ isOverdue: true, penaltySteps: 2, penaltyAmount: 5_000 });

    expect(
      computeAccruedLoanPenalty(50_000, graceEndDate, new Date("2026-11-28T18:00:00.000Z")),
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
    expect(hash1).not.toBe(hash2);
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
