import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mimeTypeFor } from "@/lib/mime";

// KYC documents and generated receipts live in a private Supabase Storage
// bucket — never reachable directly by URL. Everything must go through the
// authenticated /api/files/[...path] route, which enforces its own
// owner-or-admin check before calling readStoredFile. Because that check
// already happens at the application layer, this client uses the *service
// role* key (server-only, bypasses Row Level Security) rather than the
// public anon key — a private bucket's RLS policies would otherwise need to
// replicate the same owner-or-admin logic a second time, in SQL.
const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "diva-storage";

// Lazily constructed: `createClient` throws immediately if the key is an
// empty string, which would otherwise break `next build`'s route analysis
// (it imports this module without the real runtime env available).
let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!client) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    client = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });
  }
  return client;
}

export async function saveFile(key: string, data: Buffer): Promise<string> {
  const { error } = await getClient()
    .storage.from(bucket)
    .upload(key, data, { contentType: mimeTypeFor(key), upsert: true });
  if (error) {
    throw new Error(`Supabase Storage upload failed for "${key}": ${error.message}`);
  }
  return key;
}

export async function readStoredFile(key: string): Promise<Buffer> {
  const { data, error } = await getClient().storage.from(bucket).download(key);
  if (error) {
    throw new Error(`Supabase Storage download failed for "${key}": ${error.message}`);
  }
  return Buffer.from(await data.arrayBuffer());
}
