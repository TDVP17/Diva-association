import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Local-disk storage for KYC documents and generated receipts, kept outside
// /public so files are never directly reachable by URL — everything must go
// through the authenticated /api/files/[...path] route. Swap this module for
// an S3/GCS-backed implementation when moving off a single server instance.
// turbopackIgnore: the dir is env-configurable, but this is a dev-only local
// disk backend (see comment above) — never the storage path in a real
// deployment, so it shouldn't pull the whole project into the server bundle.
const STORAGE_ROOT = path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.STORAGE_DIR ?? "./storage");

function resolveKey(key: string): string {
  const resolved = path.resolve(/*turbopackIgnore: true*/ STORAGE_ROOT, key);
  if (!resolved.startsWith(STORAGE_ROOT + path.sep) && resolved !== STORAGE_ROOT) {
    throw new Error("Invalid storage key: path traversal detected");
  }
  return resolved;
}

export async function saveFile(key: string, data: Buffer): Promise<string> {
  const filePath = resolveKey(key);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, data);
  return key;
}

export async function readStoredFile(key: string): Promise<Buffer> {
  return readFile(resolveKey(key));
}
