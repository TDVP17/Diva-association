// Supabase Edge Function: send-email
// Handles transactional and queued email notifications via Resend.

import { createClient } from "@supabase/supabase-js";

interface BrandedEmailParams {
  title: string;
  bodyHtml?: string;
  bodyText?: string;
  actionUrl?: string;
  actionLabel?: string;
  lang?: "fr" | "en";
  baseUrl?: string;
  recipientName?: string;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function getAppBaseUrl(): string {
  return Deno.env.get("APP_URL") || "https://www.divaasso.com";
}

function renderBrandedEmailHtml(params: BrandedEmailParams): string {
  const baseUrl = params.baseUrl || getAppBaseUrl();
  const logoUrl = `${baseUrl}/icons/icon-512.png`;
  const primaryColor = "#003528";
  const rawUrl = params.actionUrl?.trim() || "/dashboard";
  let targetUrl = "";

  if (rawUrl.startsWith("http")) {
    try {
      const parsed = new URL(rawUrl);
      const baseOrigin = new URL(baseUrl).origin;
      if (parsed.origin === baseOrigin) {
        targetUrl = `${baseUrl}/open?target=${encodeURIComponent(parsed.pathname + parsed.search)}`;
      } else {
        targetUrl = rawUrl;
      }
    } catch {
      targetUrl = rawUrl;
    }
  } else {
    const cleanPath = rawUrl.startsWith("/") ? rawUrl : `/${rawUrl}`;
    targetUrl = `${baseUrl}/open?target=${encodeURIComponent(cleanPath)}`;
  }

  const actionButton = `
    <div style="margin: 28px 0 10px 0; text-align: center;">
      <a href="${targetUrl}" 
         style="background-color: ${primaryColor}; color: #ffffff; padding: 13px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px; display: inline-block; box-shadow: 0 2px 4px rgba(0,53,40,0.15);">
        ${params.actionLabel || (params.lang === "en" ? "Open in App" : "Ouvrir dans l'application")}
      </a>
    </div>
  `;

  const rawRecipient = params.recipientName?.trim();
  const firstName = rawRecipient ? rawRecipient.split(/\s+/)[0] : "";
  const greetingHtml = firstName
    ? `<p style="font-size: 16px; font-weight: 700; color: #003528; margin: 0 0 14px 0;">${
        params.lang === "en" ? `Hello, ${firstName} 👋` : `Salut, ${firstName} 👋`
      }</p>`
    : "";

  const sanitizeEmailBody = (str: string) => {
    return str
      .replace(/Salut,\s*\{name\}\s*👋/g, firstName ? `Salut, ${firstName} 👋` : "Salut 👋")
      .replace(/Hello,\s*\{name\}\s*👋/g, firstName ? `Hello, ${firstName} 👋` : "Hello 👋")
      .replace(/Bonjour,\s*\{name\}\s*👋/g, firstName ? `Bonjour, ${firstName} 👋` : "Bonjour 👋")
      .replace(/,\s*\{name\}/g, firstName ? `, ${firstName}` : "")
      .replace(/\{name\}/g, firstName || "");
  };

  let content = "";
  if (params.bodyHtml) {
    const cleanHtml = sanitizeEmailBody(params.bodyHtml);
    const hasGreeting =
      cleanHtml.includes("Salut") ||
      cleanHtml.includes("Bonjour") ||
      cleanHtml.includes("Hello");
    content = hasGreeting ? cleanHtml : `${greetingHtml}${cleanHtml}`;
  } else {
    const rawText = params.bodyText || "";
    const cleanText = sanitizeEmailBody(rawText);
    const hasGreeting =
      cleanText.startsWith("Salut") ||
      cleanText.startsWith("Bonjour") ||
      cleanText.startsWith("Hello");
    content = hasGreeting
      ? `<p style="font-size: 15px; line-height: 1.65; color: #334155; margin: 0; white-space: pre-line;">${cleanText}</p>`
      : `${greetingHtml}<p style="font-size: 15px; line-height: 1.65; color: #334155; margin: 0; white-space: pre-line;">${cleanText}</p>`;
  }

  return `
    <!DOCTYPE html>
    <html lang="${params.lang || "fr"}">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${params.title}</title>
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px 12px; -webkit-font-smoothing: antialiased;">
      <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 580px; margin: 0 auto; background-color: #ffffff; border-radius: 14px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 16px rgba(15, 23, 42, 0.04);">
        <tr>
          <td style="padding: 26px 24px 20px; text-align: center; background: linear-gradient(180deg, #f0fdf4 0%, #ffffff 100%); border-bottom: 1px solid #f1f5f9;">
            <a href="${baseUrl}" target="_blank" style="text-decoration: none; display: inline-block;">
              <img src="${logoUrl}" alt="DIVA Asso" width="60" height="60" style="display: block; margin: 0 auto 10px; border-radius: 14px; border: 1px solid #e2e8f0;" />
              <span style="display: block; font-size: 20px; font-weight: 800; color: #003528; letter-spacing: -0.5px;">DIVA Asso.</span>
            </a>
          </td>
        </tr>
        <tr>
          <td style="padding: 28px 28px 20px;">
            <h2 style="color: #0f172a; font-size: 18px; font-weight: 700; margin-top: 0; margin-bottom: 18px; line-height: 1.4;">${params.title}</h2>
            <div style="font-size: 15px; line-height: 1.6; color: #334155;">
              ${content}
            </div>
            ${actionButton}
          </td>
        </tr>
        <tr>
          <td style="padding: 20px 24px 28px; background-color: #f8fafc; border-top: 1px solid #f1f5f9; text-align: center;">
            <p style="font-size: 12px; color: #64748b; margin: 0 0 6px 0;">
              <strong>DIVA Asso.</strong> — Plateforme sécurisée de gestion des tontines et cotisations
            </p>
            <p style="font-size: 11px; color: #94a3b8; margin: 0;">
              <a href="${baseUrl}" style="color: #003528; text-decoration: underline;">www.divaasso.com</a> • Bertoua, Cameroun
            </p>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `.trim();
}

async function sendViaResend(options: {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const apiKey = (Deno.env.get("RESEND_API_KEY") ?? "").trim().replace(/^["']|["']$/g, "");
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY is not configured" };
  }

  const from =
    options.from ||
    Deno.env.get("RESEND_FROM") ||
    Deno.env.get("EMAIL_FROM") ||
    "DIVA Asso <contact@divaasso.com>";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: options.to,
      subject: options.subject,
      html: options.html,
    }),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    return {
      ok: false,
      error: errBody?.message || `Resend error HTTP ${res.status}`,
    };
  }

  const data = await res.json().catch(() => ({}));
  return { ok: true, id: data.id };
}

async function verifyAuth(req: Request, supabaseAdmin: ReturnType<typeof createClient>) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const cronSecret = Deno.env.get("CRON_SECRET") || "";

  if (token && (token === serviceRoleKey || token === cronSecret)) {
    return { authorized: true, role: "admin", isInternal: true };
  }

  if (!token) {
    return { authorized: false, error: "Missing authorization token" };
  }

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) {
    return { authorized: false, error: "Invalid user session token" };
  }

  return { authorized: true, role: "user", user };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  const auth = await verifyAuth(req, supabaseAdmin);
  if (!auth.authorized) {
    return new Response(JSON.stringify({ error: auth.error || "Unauthorized" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const actionParam = url.searchParams.get("action");

  let body: Record<string, any> = {};
  if (req.method === "POST") {
    body = await req.json().catch(() => ({}));
  }

  const action = body.action || actionParam || "send";

  // ACTION 1: Process notification queue
  if (action === "process-queue") {
    const { data: dueNotifications, error: fetchErr } = await supabaseAdmin
      .from("notifications")
      .select("id, userId, channel, type, message, actionUrl, retryCount, user:users!inner(id, email, name, preferredLang)")
      .in("status", ["PENDING", "SCHEDULED"])
      .eq("channel", "EMAIL")
      .lte("scheduledAt", new Date().toISOString())
      .order("scheduledAt", { ascending: true })
      .limit(25);

    if (fetchErr) {
      return new Response(JSON.stringify({ ok: false, error: fetchErr.message }), {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    let sent = 0;
    let failed = 0;

    for (const notif of (dueNotifications || [])) {
      await supabaseAdmin.from("notifications").update({ status: "PROCESSING" }).eq("id", notif.id);

      // Guard: PAYMENT_SUCCESS emails are already sent as official PDF receipts via settleContribution.
      // Skip queue re-delivery to prevent duplicates.
      if (notif.type === "PAYMENT_SUCCESS") {
        await supabaseAdmin.from("notifications").update({
          status: "SENT",
          sentAt: new Date().toISOString(),
        }).eq("id", notif.id);
        continue;
      }

      // Guard: Strict daily rate limit of 2 emails per 24 hours for failures and reminders
      const rateLimitedTypes = ["PAYMENT_FAILED", "CONTRIBUTION_REMINDER", "FINE_REMINDER"];
      if (rateLimitedTypes.includes(notif.type)) {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { count: dailySentCount } = await supabaseAdmin
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("userId", notif.userId)
          .eq("channel", "EMAIL")
          .eq("type", notif.type)
          .eq("status", "SENT")
          .gte("createdAt", oneDayAgo);

        if ((dailySentCount || 0) >= 2) {
          await supabaseAdmin.from("notifications").update({
            status: "FAILED",
            errorMessage: "Daily email limit of 2 reached for this notification type",
          }).eq("id", notif.id);
          continue;
        }
      }

      const user = notif.user;
      if (!user?.email) {
        await supabaseAdmin.from("notifications").update({
          status: "FAILED",
          errorMessage: "Recipient has no email on file",
        }).eq("id", notif.id);
        failed++;
        continue;
      }

      const lang = user.preferredLang === "en" ? "en" : "fr";
      let subject = "DIVA Asso";
      let bodyText = notif.message || "";

      if (notif.type === "ADMIN_BROADCAST" && bodyText.includes("\n\n")) {
        const parts = bodyText.split("\n\n");
        subject = parts[0].trim();
        bodyText = parts.slice(1).join("\n\n").trim();
      }

      const emailHtml = renderBrandedEmailHtml({
        title: subject,
        bodyText,
        actionUrl: notif.actionUrl || "/dashboard",
        lang,
        recipientName: user.name || undefined,
      });

      const sendResult = await sendViaResend({
        to: user.email,
        subject,
        html: emailHtml,
      });

      if (sendResult.ok) {
        await supabaseAdmin.from("notifications").update({
          status: "SENT",
          sentAt: new Date().toISOString(),
        }).eq("id", notif.id);
        sent++;
      } else {
        const retryCount = (notif.retryCount || 0) + 1;
        await supabaseAdmin.from("notifications").update({
          status: retryCount >= 3 ? "FAILED" : "SCHEDULED",
          retryCount: retryCount,
          errorMessage: sendResult.error,
          scheduledAt: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
        }).eq("id", notif.id);
        failed++;
      }
    }

    return new Response(
      JSON.stringify({ ok: true, processed: (dueNotifications || []).length, sent, failed }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  // ACTION 2: Direct transactional send
  const to = body.to;
  const subject = body.subject;
  let html = body.html;

  if (!to || !subject) {
    return new Response(JSON.stringify({ error: "Missing required fields: to, subject" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  if (!html) {
    html = renderBrandedEmailHtml({
      title: body.title || subject,
      bodyText: body.bodyText,
      bodyHtml: body.bodyHtml,
      actionUrl: body.actionUrl,
      actionLabel: body.actionLabel,
      lang: body.lang || "fr",
      recipientName: body.recipientName,
    });
  }

  const result = await sendViaResend({
    to,
    subject,
    html,
    from: body.from,
  });

  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 500,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
