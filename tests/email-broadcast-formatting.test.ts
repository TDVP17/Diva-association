import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  ASSO_TITLE_BADGE,
  formatBroadcastTitle,
  hasOpeningGreeting,
  renderBrandedEmailHtml,
  stripLeadingGreetingPrefix,
} from "@/lib/email/template";

const { createManyMock, findManyUsersMock } = vi.hoisted(() => ({
  createManyMock: vi.fn(),
  findManyUsersMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findMany: findManyUsersMock,
    },
    notification: {
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      createMany: createManyMock,
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
  },
}));

vi.mock("@/lib/email/resend", () => ({
  sendEmailSafe: vi.fn(async () => ({ success: true })),
}));

import { scheduleNotifications } from "@/lib/notifications/dispatch";

describe("email greeting & Asso broadcast title formatting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findManyUsersMock.mockResolvedValue([
      { id: "u-val", name: "Valentine M.", preferredLang: "fr" },
    ]);
    createManyMock.mockResolvedValue({ count: 1 });
  });

  it("strips any personal greeting prefix and adds Asso sticker badge to titles", () => {
    expect(stripLeadingGreetingPrefix("Salut, Valentine 👋 ! 📢 RAPPEL : Mode de paiement Orange Money inactif.")).toBe(
      "📢 RAPPEL : Mode de paiement Orange Money inactif."
    );
    expect(formatBroadcastTitle("Salut, Valentine 👋 ! 📢 RAPPEL : Mode de paiement Orange Money inactif.")).toBe(
      `${ASSO_TITLE_BADGE} — 📢 RAPPEL : Mode de paiement Orange Money inactif.`
    );
    expect(formatBroadcastTitle("📢 RAPPEL : Mode de paiement Orange Money inactif.")).toBe(
      `${ASSO_TITLE_BADGE} — 📢 RAPPEL : Mode de paiement Orange Money inactif.`
    );
    expect(formatBroadcastTitle("DIVA Asso — Communiqué important")).toBe(
      "DIVA Asso — Communiqué important"
    );
    expect(formatBroadcastTitle("Salut, Valentine 👋 ! ")).toBe(ASSO_TITLE_BADGE);
  });

  it("detects greetings across first lines without being fooled by leading emojis", () => {
    expect(hasOpeningGreeting("Bonjour ! Le service reprend demain.")).toBe(true);
    expect(hasOpeningGreeting("Salut, Valentine 👋\n\nLe service Orange Money...")).toBe(true);
    expect(hasOpeningGreeting("🎉 Félicitations Valentine !\nTon paiement est validé.")).toBe(true);
    expect(hasOpeningGreeting("Le service Orange Money est actuellement indisponible.")).toBe(false);
  });

  it("renders broadcast email with Asso badge in heading and only one greeting in body", () => {
    const html = renderBrandedEmailHtml({
      title: "Salut, Valentine 👋 ! 📢 RAPPEL : Mode de paiement Orange Money inactif.",
      bodyText:
        "Le service Orange Money est actuellement indisponible pour les cotisations.\nPar conséquent, toutes les transactions se font exclusivement via MTN.",
      actionUrl: "/dashboard",
      lang: "fr",
      recipientName: "Valentine M.",
    });

    expect(html).toContain(
      `<h2 style="color: #0f172a; font-size: 18px; font-weight: 700; margin-top: 0; margin-bottom: 18px; line-height: 1.4;">${ASSO_TITLE_BADGE} — 📢 RAPPEL : Mode de paiement Orange Money inactif.</h2>`
    );
    expect(html).toContain(
      `<title>${ASSO_TITLE_BADGE} — 📢 RAPPEL : Mode de paiement Orange Money inactif.</title>`
    );

    const greetingMatches = html.match(/Salut,\s*Valentine/g) ?? [];
    expect(greetingMatches).toHaveLength(1);
  });

  it("does not duplicate greeting when bodyText already starts with a standalone greeting line", () => {
    const html = renderBrandedEmailHtml({
      title: `${ASSO_TITLE_BADGE} — 📢 RAPPEL : Mode de paiement Orange Money inactif.`,
      bodyText:
        "Salut, Valentine 👋\n\nLe service Orange Money est actuellement indisponible.",
      actionUrl: "/dashboard",
      lang: "fr",
      recipientName: "Valentine M.",
    });

    const greetingMatches = html.match(/Salut,\s*Valentine/g) ?? [];
    expect(greetingMatches).toHaveLength(1);
    expect(html).toContain(
      `<p style="font-size: 16px; font-weight: 700; color: #003528; margin: 0 0 14px 0;">Salut, Valentine 👋</p>`
    );
    expect(html).toContain("Le service Orange Money est actuellement indisponible.");
  });

  it("does not prepend Salut when admin body already starts with Bonjour", () => {
    const html = renderBrandedEmailHtml({
      title: `${ASSO_TITLE_BADGE} — Message important`,
      bodyText: "Bonjour !\n\nMerci de consulter votre tableau de bord.",
      actionUrl: "/dashboard",
      lang: "fr",
      recipientName: "Valentine M.",
    });

    expect(html).not.toContain("Salut, Valentine");
    expect(html).toContain(
      `<p style="font-size: 16px; font-weight: 700; color: #003528; margin: 0 0 14px 0;">Bonjour !</p>`
    );
  });

  it("formats queued ADMIN_BROADCAST notifications with Asso title badge and single greeting", async () => {
    await scheduleNotifications({
      channel: "EMAIL",
      type: "ADMIN_BROADCAST",
      recipients: [
        {
          userId: "u-val",
          message:
            "📢 RAPPEL : Mode de paiement Orange Money inactif.\n\nLe service Orange Money est actuellement indisponible.",
          actionUrl: "/dashboard",
        },
      ],
    });

    expect(createManyMock).toHaveBeenCalledTimes(1);
    const data = createManyMock.mock.calls[0][0].data as Array<{ message: string }>;
    expect(data).toHaveLength(1);
    expect(data[0].message).toBe(
      `${ASSO_TITLE_BADGE} — 📢 RAPPEL : Mode de paiement Orange Money inactif.\n\nSalut, Valentine 👋\n\nLe service Orange Money est actuellement indisponible.`
    );
  });

  it("preserves existing Bonjour greeting in scheduled ADMIN_BROADCAST without doubling", async () => {
    await scheduleNotifications({
      channel: "EMAIL",
      type: "ADMIN_BROADCAST",
      recipients: [
        {
          userId: "u-val",
          message: "Information générale\n\nBonjour !\n\nLa réunion est maintenue.",
          actionUrl: "/dashboard",
        },
      ],
    });

    expect(createManyMock).toHaveBeenCalledTimes(1);
    const data = createManyMock.mock.calls[0][0].data as Array<{ message: string }>;
    expect(data[0].message).toBe(
      `${ASSO_TITLE_BADGE} — Information générale\n\nBonjour !\n\nLa réunion est maintenue.`
    );
  });
});

