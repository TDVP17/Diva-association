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
const primaryBucket = process.env.SUPABASE_STORAGE_BUCKET ?? "diva-storage";
const fallbackBucket = "uploads";

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
  const sb = getClient();
  let uploadResult = await sb.storage.from(primaryBucket).upload(key, data, {
    contentType: mimeTypeFor(key),
    upsert: true,
  });

  if (uploadResult.error && uploadResult.error.message?.toLowerCase().includes("not found")) {
    // Tenter de créer le bucket s'il n'existe pas
    await sb.storage.createBucket(primaryBucket, { public: false }).catch(() => null);
    uploadResult = await sb.storage.from(primaryBucket).upload(key, data, {
      contentType: mimeTypeFor(key),
      upsert: true,
    });
  }

  if (uploadResult.error && primaryBucket !== fallbackBucket) {
    // Essai sur le bucket de secours
    const fallbackResult = await sb.storage.from(fallbackBucket).upload(key, data, {
      contentType: mimeTypeFor(key),
      upsert: true,
    });
    if (!fallbackResult.error) {
      return key;
    }
  }

  if (uploadResult.error) {
    throw new Error(`Supabase Storage upload failed for "${key}": ${uploadResult.error.message}`);
  }
  return key;
}

export async function readStoredFile(key: string): Promise<Buffer> {
  const sb = getClient();
  let downloadResult = await sb.storage.from(primaryBucket).download(key);
  if (downloadResult.error && primaryBucket !== fallbackBucket) {
    downloadResult = await sb.storage.from(fallbackBucket).download(key);
  }
  if (downloadResult.error || !downloadResult.data) {
    throw new Error(`Supabase Storage download failed for "${key}": ${downloadResult.error?.message ?? "not found"}`);
  }
  return Buffer.from(await downloadResult.data.arrayBuffer());
}
