// Thin Resend client — plain fetch, no SDK, mirroring the no-dependency
// style of src/lib/whatsapp/evolution.ts for consistency.

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";
const RESEND_FROM = process.env.RESEND_FROM ?? "DIVA Associations <notifications@diva-associations.cm>";

export class ResendError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ResendError";
  }
}

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!RESEND_API_KEY) {
    throw new ResendError("Resend is not configured", 500);
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: RESEND_FROM, to, subject, html }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ResendError(body?.message ?? `Resend request failed (${res.status})`, res.status);
  }
}

/** Best-effort send: logs and swallows failures instead of throwing, for bulk/non-critical sends. */
export async function sendEmailSafe(to: string | null, subject: string, html: string): Promise<void> {
  if (!to) return;
  try {
    await sendEmail(to, subject, html);
  } catch (error) {
    console.error("Email notification failed:", error);
  }
}
