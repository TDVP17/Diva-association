import { describe, it, expect, vi, beforeEach } from "vitest";

const updateContribution = vi.fn();
const updateManyFine = vi.fn();
const transaction = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    contribution: { update: (...a: unknown[]) => updateContribution(...a) },
    fine: { updateMany: (...a: unknown[]) => updateManyFine(...a) },
    membership: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: (ops: unknown[]) => transaction(ops),
  },
}));

const generateReceiptPdf = vi.fn().mockResolvedValue(Buffer.from("pdf"));
vi.mock("@/lib/receipt", () => ({ generateReceiptPdf: (...a: unknown[]) => generateReceiptPdf(...a) }));

const saveFile = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/storage", () => ({ saveFile: (...a: unknown[]) => saveFile(...a) }));

const sendWhatsAppMessageSafe = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/whatsapp/evolution", () => ({
  sendWhatsAppMessageSafe: (...a: unknown[]) => sendWhatsAppMessageSafe(...a),
}));

const sendEmailSafe = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/email/resend", () => ({ sendEmailSafe: (...a: unknown[]) => sendEmailSafe(...a) }));

const scheduleInAppNotifications = vi.fn().mockResolvedValue(1);
vi.mock("@/lib/notifications/dispatch", () => ({
  scheduleInAppNotifications: (...a: unknown[]) => scheduleInAppNotifications(...a),
}));

import { settleContribution, settleContributionsBatch } from "@/lib/settle-contribution";
import { formatXAF } from "@/lib/format-currency";

function baseContribution(overrides: Record<string, unknown> = {}) {
  return {
    id: "contrib-1",
    membershipSlotId: "slot-1",
    dueDate: new Date("2026-01-04"),
    amountPaid: 2500,
    feePaid: 100,
    finePaid: 0,
    providerFeeAmount: 0,
    recordedByAdminId: null,
    fapshiTxRef: "tx-1",
    paidByUser: null,
    membershipSlot: {
      id: "slot-1",
      beneficiaryName: "Marie Fotso",
      membership: {
        userId: "user-1",
        tontineSessionId: "session-1",
        user: {
          id: "user-1",
          name: "Marie Fotso",
          email: "marie@example.com",
          phone: "677123456",
          preferredLang: "fr",
        },
        tontineSession: { type: "HEBDO_SUNDAY", title: null },
      },
    },
    ...overrides,
  } as never;
}

describe("settleContribution — recipient-language email/WhatsApp", () => {
  beforeEach(() => {
    updateContribution.mockReset();
    updateManyFine.mockReset();
    transaction.mockReset().mockResolvedValue([{}]);
    generateReceiptPdf.mockClear();
    saveFile.mockClear();
    sendWhatsAppMessageSafe.mockClear();
    sendEmailSafe.mockClear();
    scheduleInAppNotifications.mockClear();
  });

  it("sends the beneficiary's payment-success email in their own preferredLang (fr), not hardcoded English", async () => {
    await settleContribution(baseContribution(), { paidAt: new Date(), origin: "https://app.example.com" });

    expect(sendEmailSafe).toHaveBeenCalledTimes(1);
    const [, subject, html] = sendEmailSafe.mock.calls[0];
    expect(subject).toMatch(/^Paiement reçu — /);
    expect(html).toContain("Bonjour Marie Fotso,");
    expect(html).toContain("🎉 Votre contribution a été reçue avec succès.");
  });

  it("sends the beneficiary's payment-success email in English when preferredLang is en", async () => {
    await settleContribution(
      baseContribution({
        membershipSlot: {
          id: "slot-1",
          beneficiaryName: "John Doe",
          membership: {
            tontineSessionId: "session-1",
            user: { id: "user-1", name: "John Doe", email: "john@example.com", phone: "677123456", preferredLang: "en" },
            tontineSession: { type: "HEBDO_SUNDAY", title: null },
          },
        },
      }),
      { paidAt: new Date(), origin: "https://app.example.com" },
    );

    const [, subject, html] = sendEmailSafe.mock.calls[0];
    expect(subject).toMatch(/^Payment received — /);
    expect(html).toContain("Hello John Doe,");
    expect(html).toContain("Your contribution has been received successfully");
  });

  it("sends the payer's own confirmation email in the PAYER's preferredLang, independent of the beneficiary's language", async () => {
    await settleContribution(
      baseContribution({
        paidByUser: {
          id: "payer-1",
          name: "Paul Payer",
          email: "paul@example.com",
          preferredLang: "en", // payer prefers English even though beneficiary (Marie) prefers French
        },
      }),
      { paidAt: new Date(), origin: "https://app.example.com" },
    );

    expect(sendEmailSafe).toHaveBeenCalledTimes(2);
    const beneficiaryCall = sendEmailSafe.mock.calls.find((c) => c[0] === "marie@example.com")!;
    const payerCall = sendEmailSafe.mock.calls.find((c) => c[0] === "paul@example.com")!;

    expect(beneficiaryCall[1]).toMatch(/^Paiement reçu — /); // beneficiary: French
    expect(payerCall[1]).toMatch(/^Payment sent — /); // payer: English, independently
    expect(payerCall[2]).toContain("Hello Paul Payer,");
  });

  it("does not send a second email when the payer is the same user as the beneficiary", async () => {
    await settleContribution(
      baseContribution({ paidByUser: { id: "user-1", name: "Marie Fotso", email: "marie@example.com", preferredLang: "fr" } }),
      { paidAt: new Date(), origin: "https://app.example.com" },
    );

    expect(sendEmailSafe).toHaveBeenCalledTimes(1);
    const [, , html] = sendEmailSafe.mock.calls[0];
    expect(html).not.toContain("Payé par");
  });

  it("strictly excludes 3.1% operator fees from email receipts and uses the updated DIVA asso closing line", async () => {
    await settleContribution(
      baseContribution({
        providerFeeAmount: 81,
        amountPaid: 2500,
        feePaid: 100,
        finePaid: 0,
      }),
      { paidAt: new Date(), origin: "https://app.example.com" },
    );

    expect(sendEmailSafe).toHaveBeenCalledTimes(1);
    const [, , html] = sendEmailSafe.mock.calls[0];
    expect(html).toContain(formatXAF(2600));
    expect(html).not.toContain("2 681");
    expect(html).not.toContain("2\u00A0681");
    expect(html).not.toContain("3,1%");
    expect(html).not.toContain("3.1%");
    expect(html).toContain("Merci pour votre contribution chez DIVA asso.");
    expect(html).not.toContain("caisse commune");
    expect(generateReceiptPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 2500,
        fee: 100,
        fine: 0,
        total: 2600,
      }),
    );
  });
});

describe("settleContributionsBatch — consolidated single email for multiple slots", () => {
  beforeEach(() => {
    updateContribution.mockReset();
    updateManyFine.mockReset();
    transaction.mockReset().mockResolvedValue([{}]);
    generateReceiptPdf.mockClear();
    saveFile.mockClear();
    sendWhatsAppMessageSafe.mockClear();
    sendEmailSafe.mockClear();
    scheduleInAppNotifications.mockClear();
  });

  function slotContrib(id: string, slotId: string, beneficiaryName: string, extra: Record<string, unknown> = {}) {
    return baseContribution({
      id,
      membershipSlotId: slotId,
      providerFeeAmount: 81,
      fapshiTxRef: `tx-bulk-${id}`,
      membershipSlot: {
        id: slotId,
        beneficiaryName,
        membership: {
          userId: "user-1",
          tontineSessionId: "session-1",
          user: {
            id: "user-1",
            name: "Femme Batcham Bertoua",
            email: "femme@example.com",
            phone: "677123456",
            preferredLang: "fr",
          },
          tontineSession: { type: "HEBDO_SUNDAY", title: "Chaque dimanche" },
        },
      },
      ...extra,
    });
  }

  it("sends ONE consolidated email citing all 3 paid slot names (out of 5), with net sum excluding 3.1%", async () => {
    const batch = [
      slotContrib("c1", "s1", "Joël1"),
      slotContrib("c2", "s2", "Joël2"),
      slotContrib("c3", "s3", "Joël3"),
    ];

    await settleContributionsBatch(batch, {
      paidAt: new Date("2026-11-08T12:00:00Z"),
      origin: "https://www.divaasso.com",
      transRefOverride: "fapshi-tx-999",
      bulkPaymentId: "blk-1",
    });

    expect(sendEmailSafe).toHaveBeenCalledTimes(1);
    const [to, subject, html] = sendEmailSafe.mock.calls[0];
    expect(to).toBe("femme@example.com");
    expect(subject).toBe("Paiement reçu — Chaque dimanche");
    expect(html).toContain("Contribution pour (3)");
    expect(html).toContain("Joël1");
    expect(html).toContain("Joël2");
    expect(html).toContain("Joël3");
    expect(html).toContain(formatXAF(7800));
    expect(html).not.toContain("8\u00A0042");
    expect(html).not.toContain("8 042");
    expect(html).toContain("fapshi-tx-999");
    expect(html).toContain("Merci pour votre contribution chez DIVA asso.");
    expect(html).toContain(encodeURIComponent("/api/files/receipts/user-1/bulk-blk-1-owner.pdf"));

    // Only 1 consolidated in-app notification to the member
    expect(scheduleInAppNotifications).toHaveBeenCalledTimes(1);
  });

  it("sends 1 consolidated email to the account owner and 1 consolidated email to the relative payer in each user's preferredLang", async () => {
    const payer = {
      id: "payer-9",
      name: "Tantine Grace",
      email: "grace@example.com",
      preferredLang: "en",
    };
    const batch = [
      slotContrib("c1", "s1", "Joël1", { paidByUser: payer }),
      slotContrib("c2", "s2", "Joël2", { paidByUser: payer }),
      slotContrib("c3", "s3", "Joël3", { paidByUser: payer }),
    ];

    await settleContributionsBatch(batch, {
      paidAt: new Date("2026-11-08T12:00:00Z"),
      origin: "https://www.divaasso.com",
      transRefOverride: "fapshi-tx-rel",
      bulkPaymentId: "blk-rel",
    });

    expect(sendEmailSafe).toHaveBeenCalledTimes(2);
    const ownerCall = sendEmailSafe.mock.calls.find((c) => c[0] === "femme@example.com")!;
    const payerCall = sendEmailSafe.mock.calls.find((c) => c[0] === "grace@example.com")!;

    // Owner gets FR email citing all 3 names + paid by Tantine Grace + 7 800 FCFA
    expect(ownerCall[1]).toBe("Paiement reçu — Chaque dimanche");
    expect(ownerCall[2]).toContain("Joël1");
    expect(ownerCall[2]).toContain("Joël2");
    expect(ownerCall[2]).toContain("Joël3");
    expect(ownerCall[2]).toContain("Tantine Grace");
    expect(ownerCall[2]).toContain(formatXAF(7800));
    expect(ownerCall[2]).toContain("Merci pour votre contribution chez DIVA asso.");

    // Relative payer gets EN email citing all 3 names + 7 800 FCFA + EN closing line
    expect(payerCall[1]).toBe("Payment sent — Chaque dimanche");
    expect(payerCall[2]).toContain("Hello Tantine Grace,");
    expect(payerCall[2]).toContain("Joël1");
    expect(payerCall[2]).toContain("Joël2");
    expect(payerCall[2]).toContain("Joël3");
    expect(payerCall[2]).toContain(formatXAF(7800));
    expect(payerCall[2]).toContain("Thank you for your contribution to DIVA asso.");
  });

  it("generates and uploads a single consolidated batch PDF when called without bulkPaymentId (e.g. proof batch approval)", async () => {
    const batch = [
      slotContrib("c1", "s1", "Joël1"),
      slotContrib("c2", "s2", "Joël2"),
    ];

    await settleContributionsBatch(batch, {
      paidAt: new Date("2026-11-08T12:00:00Z"),
      origin: "https://www.divaasso.com",
    });

    expect(sendEmailSafe).toHaveBeenCalledTimes(1);
    const [, , html] = sendEmailSafe.mock.calls[0];
    expect(html).toContain("Joël1");
    expect(html).toContain("Joël2");
    expect(html).toContain(formatXAF(5200));
    expect(html).toContain("batch-");
    expect(generateReceiptPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        beneficiaryNames: ["Joël1", "Joël2"],
        total: 5200,
      }),
    );
  });
});
