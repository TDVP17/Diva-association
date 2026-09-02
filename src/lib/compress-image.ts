"use client";

import imageCompression from "browser-image-compression";

// Matches MAX_BYTES_PER_FILE in src/app/api/sessions/[id]/kyc/route.ts.
// Three uncompressed modern-phone photos (8-15MB each, or HEIC that this
// library can't decode) can total 30-45MB, which blows past Vercel's
// ~4.5MB serverless request body limit and used to surface only as an
// opaque 500 on submit — this catches it here instead, with a size the
// caller can show to the user.
export const MAX_OUTPUT_BYTES = 1.5 * 1024 * 1024;

export function formatImageSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export class ImageTooLargeError extends Error {
  constructor(readonly sizeBytes: number) {
    super(`Image is ${formatImageSize(sizeBytes)} after compression, over the limit`);
  }
}

/**
 * Compresses an image blob client-side, before it's ever uploaded — never
 * upload-then-compress. Targets ~400KB (within the requested 200–500KB
 * range) and caps the longest edge at 1024px, which is plenty for an
 * avatar or ID photo. Runs in a web worker so it never blocks the UI
 * thread.
 *
 * On compression failure (an unsupported format like HEIC, a worker error)
 * this falls back to the original blob — fine for an already-small image,
 * but a large original combined with a failed compression is exactly the
 * scenario that used to silently produce a multi-megabyte upload. Any
 * result — compressed or the raw fallback — still over MAX_OUTPUT_BYTES
 * throws ImageTooLargeError instead, so the caller can show a specific,
 * actionable message rather than attempt a doomed upload.
 */
export async function compressImage(blob: Blob): Promise<Blob> {
  let result: Blob;
  try {
    result = await imageCompression(blob as File, {
      maxSizeMB: 0.4,
      maxWidthOrHeight: 1024,
      useWebWorker: true,
    });
  } catch (err) {
    console.error("[compressImage] compression failed, falling back to the original blob:", err);
    result = blob;
  }
  if (result.size > MAX_OUTPUT_BYTES) {
    throw new ImageTooLargeError(result.size);
  }
  return result;
}
