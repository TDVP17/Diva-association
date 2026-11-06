import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  runAutoDispatcher,
  runCheckPenaltiesTask,
  runFoodTurnTask,
  runProcessRefundQueueTask,
  runReminderEveTask,
  runReminderNoonTask,
  runReminderUrgentTask,
  runTurnReminderTask,
} from "./tasks.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function getSupabaseAdmin(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Vérification de sécurité :
 * 1. Clé secrète `x-cron-secret` correspondant à `CRON_SECRET`
 * 2. Token Bearer Service Role (`SUPABASE_SERVICE_ROLE_KEY`)
 * 3. Token Bearer d'un administrateur/président authentifié
 */
async function isAuthorized(
  req: Request,
  supabase: SupabaseClient,
  url: URL,
): Promise<boolean> {
  const cronSecretEnv = Deno.env.get("CRON_SECRET");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  const headerSecret = req.headers.get("x-cron-secret")?.trim();
  const querySecret = url.searchParams.get("secret")?.trim();
  if (
    cronSecretEnv &&
    ((headerSecret && headerSecret === cronSecretEnv) ||
      (querySecret && querySecret === cronSecretEnv))
  ) {
    return true;
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (tokenMatch) {
    const token = tokenMatch[1].trim();
    if (serviceRoleKey && token === serviceRoleKey) {
      return true;
    }

    const { data, error } = await supabase.auth.getUser(token);
    if (!error && data?.user?.email) {
      const { data: dbUser } = await supabase
        .from("users")
        .select("role, isBanned")
        .ilike("email", data.user.email)
        .maybeSingle();

      if (
        dbUser &&
        !dbUser.isBanned &&
        (dbUser.role === "ADMIN" || dbUser.role === "PRESIDENT")
      ) {
        return true;
      }
    }
  }

  return false;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = getSupabaseAdmin();
    const url = new URL(req.url);

    if (!(await isAuthorized(req, supabase, url))) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    let taskName =
      url.searchParams.get("task")?.trim().toLowerCase() ||
      url.pathname.replace(/^\/?(?:functions\/v1\/)?tontine-cron\/?/, "").trim().toLowerCase();

    if (req.method === "POST" && !taskName) {
      const body = (await req.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (typeof body.task === "string") {
        taskName = body.task.trim().toLowerCase();
      }
    }

    const now = new Date();

    switch (taskName) {
      case "turn-reminder":
        return jsonResponse(await runTurnReminderTask(supabase, now));

      case "reminder-eve":
        return jsonResponse(await runReminderEveTask(supabase, now));

      case "reminder-noon":
        return jsonResponse(await runReminderNoonTask(supabase, now));

      case "reminder-urgent":
        return jsonResponse(await runReminderUrgentTask(supabase, now));

      case "food-turn":
        return jsonResponse(await runFoodTurnTask(supabase, now));

      case "check-penalties":
        return jsonResponse(await runCheckPenaltiesTask(supabase, now));

      case "process-refund-queue":
        return jsonResponse(await runProcessRefundQueueTask(supabase, now));

      case "all": {
        const results = [
          await runTurnReminderTask(supabase, now),
          await runReminderEveTask(supabase, now),
          await runReminderNoonTask(supabase, now),
          await runReminderUrgentTask(supabase, now),
          await runFoodTurnTask(supabase, now),
          await runCheckPenaltiesTask(supabase, now),
          await runProcessRefundQueueTask(supabase, now),
        ];
        return jsonResponse({
          task: "all",
          ok: results.every((r) => r.ok),
          checkedAt: now.toISOString(),
          results,
        });
      }

      case "auto":
      case "":
      default:
        return jsonResponse({
          task: "auto",
          checkedAt: now.toISOString(),
          results: await runAutoDispatcher(supabase, now),
        });
    }
  } catch (err) {
    console.error("[tontine-cron] unhandled error:", err);
    return jsonResponse(
      {
        error: err instanceof Error ? err.message : "Internal server error",
      },
      500,
    );
  }
});
