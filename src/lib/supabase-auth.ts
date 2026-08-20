import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-side client for verifying/creating Supabase Auth identities
// (email+password sign-in/sign-up). Uses the publishable/anon key — that's
// its intended purpose, unlike src/lib/storage.ts which needs the secret
// key to bypass RLS for cross-user file access.
//
// Lazily constructed for the same reason as storage.ts: `createClient`
// throws immediately on an empty key, which would otherwise break
// `next build`'s route-collection phase before real env vars are wired up.
let client: SupabaseClient | null = null;

export function getSupabaseAuthClient(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
    client = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
