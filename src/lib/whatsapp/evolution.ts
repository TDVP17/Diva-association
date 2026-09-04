// Evolution API client — self-hosted WhatsApp gateway.
// API reference: https://doc.evolution-api.com/v2/api-reference/message-controller/send-text

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL ?? "";
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY ?? "";
const EVOLUTION_INSTANCE_NAME = process.env.EVOLUTION_INSTANCE_NAME ?? "";

export class EvolutionApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "EvolutionApiError";
  }
}

/**
 * Evolution API (Baileys/WhatsApp) needs the FULL international number
 * (country code + subscriber number, no `+`) to resolve a WhatsApp JID —
 * unlike Fapshi, which is Cameroon-only and accepts the bare 9-digit local
 * number (see normalizeCameroonPhone in src/lib/fapshi.ts). User.phone is
 * stored in that bare local format throughout the app, so it must be
 * prefixed with "237" here specifically, or every WhatsApp send silently
 * targets a non-existent JID.
 */
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("237")) return digits;
  if (/^[6-9]\d{8}$/.test(digits)) return `237${digits}`;
  return digits;
}

export async function sendWhatsAppMessage(phone: string, text: string): Promise<void> {
  const number = normalizePhone(phone);
  if (!number) {
    throw new EvolutionApiError("Cannot send WhatsApp message: empty phone number", 400);
  }
  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY || !EVOLUTION_INSTANCE_NAME) {
    throw new EvolutionApiError("Evolution API is not configured", 500);
  }

  const res = await fetch(
    `${EVOLUTION_API_URL}/message/sendText/${encodeURIComponent(EVOLUTION_INSTANCE_NAME)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: EVOLUTION_API_KEY,
      },
      body: JSON.stringify({ number, text }),
    },
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new EvolutionApiError(
      body?.message ?? `Evolution API sendText failed (${res.status})`,
      res.status,
    );
  }
}

/**
 * Best-effort send: logs and swallows failures instead of throwing, for call
 * sites (crons, webhooks) where a WhatsApp outage must never break the
 * underlying financial operation it's reporting on.
 */
export async function sendWhatsAppMessageSafe(phone: string | null, text: string): Promise<void> {
  if (!phone) return;
  try {
    await sendWhatsAppMessage(phone, text);
  } catch (error) {
    console.error("WhatsApp notification failed:", error);
  }
}
