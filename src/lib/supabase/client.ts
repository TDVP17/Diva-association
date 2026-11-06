"use client";

import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { bootstrapLegacySessionToSupabaseAction } from "@/lib/supabase/bootstrap-action";

export const SB_ACCESS_COOKIE = "sb-access-token";
export const SB_REFRESH_COOKIE = "sb-refresh-token";
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

function readDocumentCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${name}=`;
  const parts = document.cookie.split(";");
  for (const raw of parts) {
    const trimmed = raw.trim();
    if (trimmed.startsWith(prefix)) {
      try {
        return decodeURIComponent(trimmed.slice(prefix.length));
      } catch {
        return trimmed.slice(prefix.length);
      }
    }
  }
  return null;
}

export function writeBrowserSupabaseCookies(session: Pick<Session, "access_token" | "refresh_token">) {
  if (typeof document === "undefined") return;
  const secureFlag = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${SB_ACCESS_COOKIE}=${encodeURIComponent(session.access_token)}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax${secureFlag}`;
  if (session.refresh_token) {
    document.cookie = `${SB_REFRESH_COOKIE}=${encodeURIComponent(session.refresh_token)}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax${secureFlag}`;
  }
}

export function clearBrowserSupabaseCookies() {
  if (typeof document === "undefined") return;
  const secureFlag = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${SB_ACCESS_COOKIE}=; path=/; max-age=0; samesite=lax${secureFlag}`;
  document.cookie = `${SB_REFRESH_COOKIE}=; path=/; max-age=0; samesite=lax${secureFlag}`;
}

/**
 * Browser singleton Supabase client shared across Auth, Realtime listeners
 * (chat, notifications, KYC verification, Mobile Money payment status) and
 * direct Edge Function / PostgREST calls.
 *
 * Persists and auto-refreshes the Supabase JWT directly in the browser (0 CPU
 * on Vercel) while mirroring `sb-access-token` / `sb-refresh-token` cookies so
 * Next.js Server Components stay in sync.
 */
let browserClient: SupabaseClient | null = null;
let bootstrapPromise: Promise<Session | null> | null = null;

export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (typeof window === "undefined") return null;
  if (browserClient) return browserClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const client = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  client.auth.onAuthStateChange((event, session) => {
    if (session?.access_token) {
      writeBrowserSupabaseCookies(session);
      client.realtime.setAuth(session.access_token);
    } else if (event === "SIGNED_OUT") {
      clearBrowserSupabaseCookies();
      client.realtime.setAuth("");
    }
  });

  // Hydrate browser session from server-written cookies if localStorage is empty
  void client.auth.getSession().then(({ data }) => {
    if (data.session?.access_token) {
      writeBrowserSupabaseCookies(data.session);
      client.realtime.setAuth(data.session.access_token);
      return;
    }
    const cookieAccess = readDocumentCookie(SB_ACCESS_COOKIE);
    const cookieRefresh = readDocumentCookie(SB_REFRESH_COOKIE);
    if (cookieAccess && cookieRefresh) {
      void client.auth.setSession({
        access_token: cookieAccess,
        refresh_token: cookieRefresh,
      });
    }
  });

  browserClient = client;
  return browserClient;
}

/**
 * Ensures the browser holds a valid Supabase Auth session matching `expectedEmail`
 * (or upgrades an active legacy NextAuth cookie session silently once).
 */
export async function ensureBrowserSupabaseSession(expectedEmail?: string): Promise<Session | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;

  const { data } = await supabase.auth.getSession();
  let session = data.session;

  if (!session) {
    const cookieAccess = readDocumentCookie(SB_ACCESS_COOKIE);
    const cookieRefresh = readDocumentCookie(SB_REFRESH_COOKIE);
    if (cookieAccess && cookieRefresh) {
      const restored = await supabase.auth.setSession({
        access_token: cookieAccess,
        refresh_token: cookieRefresh,
      });
      session = restored.data.session;
    }
  }

  const normalizedExpected = expectedEmail?.trim().toLowerCase();
  const matchesExpected =
    !normalizedExpected || session?.user?.email?.trim().toLowerCase() === normalizedExpected;

  if (session && matchesExpected) {
    const expiresAtMs = session.expires_at ? session.expires_at * 1000 : 0;
    if (expiresAtMs > 0 && expiresAtMs - Date.now() < 60_000) {
      const { data: refreshed } = await supabase.auth.refreshSession();
      if (refreshed.session) {
        session = refreshed.session;
      }
    }
    writeBrowserSupabaseCookies(session);
    supabase.realtime.setAuth(session.access_token);
    return session;
  }

  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      try {
        const res = await bootstrapLegacySessionToSupabaseAction();
        if (!res.ok || !res.accessToken || !res.refreshToken) {
          return null;
        }
        const upgraded = await supabase.auth.setSession({
          access_token: res.accessToken,
          refresh_token: res.refreshToken,
        });
        if (upgraded.data.session) {
          writeBrowserSupabaseCookies(upgraded.data.session);
          supabase.realtime.setAuth(upgraded.data.session.access_token);
          return upgraded.data.session;
        }
        return null;
      } catch {
        return null;
      } finally {
        bootstrapPromise = null;
      }
    })();
  }

  return bootstrapPromise;
}

/**
 * Returns a fresh Supabase `Bearer` access token for calling Supabase Edge
 * Functions (`fapshi-pay`, etc.), automatically refreshing if near expiry or
 * upgrading a legacy session on the fly.
 */
export async function getSupabaseAccessToken(): Promise<string | null> {
  const session = await ensureBrowserSupabaseSession();
  return session?.access_token ?? null;
}

/**
 * Builds the URL of the `fapshi-pay` Supabase Edge Function (`initiate`,
 * `relative`, `bulk`, `bulk-quote`, `fine`, `fine-quote`, `quote`, `status`).
 */
export function getFapshiEdgeUrl(subPath?: string): string {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  const cleanSub = (subPath ?? "").replace(/^\/+/, "");
  return cleanSub ? `${base}/functions/v1/fapshi-pay/${cleanSub}` : `${base}/functions/v1/fapshi-pay`;
}
