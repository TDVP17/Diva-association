"use server";

import { auth } from "@/auth";
import { getSupabaseAdminClient, getSupabaseAuthClient } from "@/lib/supabase-auth";
import { clearServerAuthCookies, setServerSupabaseCookies } from "@/lib/supabase/auth-cookies";

/**
 * Upgrades an active legacy NextAuth cookie session into a native Supabase Auth
 * `Bearer` session (1-time silent exchange, 0 emails sent, 0 user friction).
 */
export async function bootstrapLegacySessionToSupabaseAction(): Promise<{
  ok: boolean;
  accessToken?: string;
  refreshToken?: string;
}> {
  try {
    const session = await auth();
    const email = session?.user?.email?.trim().toLowerCase();
    if (!email) {
      return { ok: false };
    }

    const admin = getSupabaseAdminClient();
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    const tokenHash = linkData?.properties?.hashed_token;
    if (linkErr || !tokenHash) {
      console.error("[bootstrapLegacySession] generateLink failed:", linkErr?.message);
      return { ok: false };
    }

    const anon = getSupabaseAuthClient();
    const { data: verified, error: verifyErr } = await anon.auth.verifyOtp({
      token_hash: tokenHash,
      type: "magiclink",
    });
    if (verifyErr || !verified?.session?.access_token || !verified?.session?.refresh_token) {
      console.error("[bootstrapLegacySession] verifyOtp failed:", verifyErr?.message);
      return { ok: false };
    }

    await clearServerAuthCookies();
    await setServerSupabaseCookies(verified.session.access_token, verified.session.refresh_token);

    return {
      ok: true,
      accessToken: verified.session.access_token,
      refreshToken: verified.session.refresh_token,
    };
  } catch (err) {
    console.error("[bootstrapLegacySession] unexpected error:", err);
    return { ok: false };
  }
}

