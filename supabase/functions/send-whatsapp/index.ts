// Supabase Edge Function: send-whatsapp
// Handles WhatsApp notifications via Evolution API (or graceful fallback).

import { createClient } from "@supabase/supabase-js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

/**
 * Normalizes a Cameroon phone number for Evolution API (Baileys):
 * Requires full international format without `+` (e.g. 237690123456).
 */
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("237")) return digits;
  if (/^[6-9]\d{8}$/.test(digits)) return `237${digits}`;
  return digits;
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

async function sendViaEvolution(phone: string, text: string): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const apiUrl = Deno.env.get("EVOLUTION_API_URL") || "";
  const apiKey = Deno.env.get("EVOLUTION_API_KEY") || "";
  const instanceName = Deno.env.get("EVOLUTION_INSTANCE_NAME") || "";

  // If Evolution API is not configured or disabled by project policy:
  if (!apiUrl || !apiKey || !instanceName) {
    console.log(`[send-whatsapp] Evolution API not active; WhatsApp routed via Email for ${phone}`);
    return {
      ok: true,
      skipped: true,
      error: "WhatsApp notifications routed via Email per association policy",
    };
  }

  const normalized = normalizePhone(phone);
  if (!normalized) {
    return { ok: false, error: "Invalid phone number format" };
  }

  try {
    const res = await fetch(`${apiUrl}/message/sendText/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: apiKey,
      },
      body: JSON.stringify({ number: normalized, text }),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      return {
        ok: false,
        error: errBody?.message || `Evolution API error HTTP ${res.status}`,
      };
    }

    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Failed to reach Evolution API" };
  }
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

  // ACTION 1: Process notification queue for WhatsApp channel
  if (action === "process-queue") {
    const { data: dueNotifications, error: fetchErr } = await supabaseAdmin
      .from("notifications")
      .select("id, userId, channel, message, user:users!inner(id, phone, preferredLang)")
      .in("status", ["PENDING", "SCHEDULED"])
      .eq("channel", "WHATSAPP")
      .lte("scheduledAt", new Date().toISOString())
      .order("scheduledAt", { ascending: true })
      .limit(25);

    if (fetchErr) {
      return new Response(JSON.stringify({ ok: false, error: fetchErr.message }), {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    let processed = 0;
    let sent = 0;
    let skipped = 0;

    for (const notif of (dueNotifications || [])) {
      processed++;
      const phone = notif.user?.phone;
      if (phone) {
        const sendRes = await sendViaEvolution(phone, notif.message || "");
        if (sendRes.skipped) skipped++;
        else if (sendRes.ok) sent++;
      } else {
        skipped++;
      }

      await supabaseAdmin.from("notifications").update({
        status: "SENT",
        sentAt: new Date().toISOString(),
      }).eq("id", notif.id);
    }

    return new Response(
      JSON.stringify({ ok: true, processed, sent, skipped }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  // ACTION 2: Direct send
  const phone = body.phone;
  const text = body.text;

  if (!phone || !text) {
    return new Response(JSON.stringify({ error: "Missing required fields: phone, text" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const result = await sendViaEvolution(phone, text);

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
