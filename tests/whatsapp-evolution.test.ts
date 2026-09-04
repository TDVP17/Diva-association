import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

// evolution.ts reads EVOLUTION_API_URL/KEY/INSTANCE_NAME from process.env at
// MODULE LOAD time (not per-call), so each test needs a fresh module
// instance after setting env vars — a plain top-level import would only
// ever see whatever env was present at the very first import.
async function loadEvolutionClient() {
  vi.resetModules();
  return import("@/lib/whatsapp/evolution");
}

describe("sendWhatsAppMessage phone normalization", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    process.env.EVOLUTION_API_URL = "https://evolution.example.com";
    process.env.EVOLUTION_API_KEY = "test-key";
    process.env.EVOLUTION_INSTANCE_NAME = "diva";
  });

  it("prefixes a bare 9-digit Cameroon local number with the 237 country code — the app stores phone numbers this way everywhere else, but Baileys/WhatsApp needs the full international number to resolve a JID", async () => {
    const { sendWhatsAppMessage } = await loadEvolutionClient();
    await sendWhatsAppMessage("677123456", "hello");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.number).toBe("237677123456");
  });

  it("does not double-prefix a number that already includes the 237 country code", async () => {
    const { sendWhatsAppMessage } = await loadEvolutionClient();
    await sendWhatsAppMessage("237677123456", "hello");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.number).toBe("237677123456");
  });

  it("strips formatting characters (+, spaces, dashes) before prefixing", async () => {
    const { sendWhatsAppMessage } = await loadEvolutionClient();
    await sendWhatsAppMessage("+237 677-123-456", "hello");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.number).toBe("237677123456");
  });

  it("leaves a number that doesn't match the known local-number shape untouched (never guesses)", async () => {
    const { sendWhatsAppMessage } = await loadEvolutionClient();
    await sendWhatsAppMessage("12345", "hello");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.number).toBe("12345");
  });

  it("throws when Evolution API isn't configured, rather than silently pretending to send", async () => {
    delete process.env.EVOLUTION_API_URL;
    const { sendWhatsAppMessage } = await loadEvolutionClient();
    await expect(sendWhatsAppMessage("677123456", "hello")).rejects.toThrow(/not configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when the Evolution API responds with a non-OK status", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({ message: "boom" }) });
    const { sendWhatsAppMessage } = await loadEvolutionClient();
    await expect(sendWhatsAppMessage("677123456", "hello")).rejects.toThrow("boom");
  });
});

describe("sendWhatsAppMessageSafe", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    process.env.EVOLUTION_API_URL = "https://evolution.example.com";
    process.env.EVOLUTION_API_KEY = "test-key";
    process.env.EVOLUTION_INSTANCE_NAME = "diva";
  });

  it("no-ops for a null phone instead of throwing", async () => {
    const { sendWhatsAppMessageSafe } = await loadEvolutionClient();
    await sendWhatsAppMessageSafe(null, "hello");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("swallows a delivery failure instead of throwing", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const { sendWhatsAppMessageSafe } = await loadEvolutionClient();
    await expect(sendWhatsAppMessageSafe("677123456", "hello")).resolves.toBeUndefined();
  });
});
