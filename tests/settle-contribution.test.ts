import { describe, it, expect, vi, beforeEach } from "vitest";

const updateContribution = vi.fn();
const updateManyFine = vi.fn();
const transaction = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    contribution: { update: (...a: unknown[]) => updateContribution(...a) },
    fine: { updateMany: (...a: unknown[]) => updateManyFine(...a) },
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

import { settleContribution } from "@/lib/settle-contribution";

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
  });
});
