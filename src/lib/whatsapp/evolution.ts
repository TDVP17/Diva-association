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

export async function sendWhatsAppMessage(_phone: string, _text: string): Promise<void> {
  // WhatsApp notifications are completely disabled by user policy in favor of Email notifications.
  return;
}

/**
 * WhatsApp notifications are completely disabled by user policy in favor of Email notifications.
 */
export async function sendWhatsAppMessageSafe(_phone: string | null, _text: string): Promise<void> {
  // No-op: all alerts routed through Email.
  return;
}
