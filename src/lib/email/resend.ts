import crypto from "crypto";

// Thin Resend client — plain fetch, no SDK, mirroring the no-dependency
// style of src/lib/whatsapp/evolution.ts for consistency.

const RESEND_API_KEY = (process.env.RESEND_API_KEY ?? "").trim().replace(/^["']|["']$/g, "");
const RESEND_FROM =
  process.env.RESEND_FROM || process.env.EMAIL_FROM || "DIVA Asso <contact@divaasso.com>";
const RESEND_REPLY_TO =
  process.env.RESEND_REPLY_TO || "contact@divaasso.com";

export class ResendError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ResendError";
  }
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<a\s+(?:[^>]*?\s+)?href=(["'])(.*?)\1[^>]*>(.*?)<\/a>/gi, "$3 ($2)")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<td[^>]*>(.*?)<\/td>/gi, "$1 ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function sendEmail(to: string, subject: string, html: string, text?: string): Promise<void> {
  if (!RESEND_API_KEY) {
    throw new ResendError("Resend is not configured", 500);
  }

  const plainText = text || htmlToPlainText(html);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      reply_to: RESEND_REPLY_TO,
      to,
      subject,
      html,
      text: plainText,
      headers: {
        "X-Entity-Ref-ID": crypto.randomUUID(),
      },
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    console.error("[resend] API error response:", body);
    throw new ResendError(body?.message ?? `Resend request failed (${res.status})`, res.status);
  }
}

/** Best-effort send: logs and swallows failures instead of throwing, for bulk/non-critical sends. */
export async function sendEmailSafe(to: string | null, subject: string, html: string, text?: string): Promise<void> {
  if (!to) return;
  try {
    await sendEmail(to, subject, html, text);
  } catch (error) {
    console.error("Email notification failed:", error);
  }
}
