"use client";

import imageCompression from "browser-image-compression";

/**
 * Compresses an image blob client-side, before it's ever uploaded — never
 * upload-then-compress. Targets ~400KB (within the requested 200–500KB
 * range) and caps the longest edge at 1024px, which is plenty for an
 * avatar. Runs in a web worker so it never blocks the UI thread. Falls
 * back to the original, uncompressed blob on any failure (an
 * already-small image, an unsupported format, a worker error) — never
 * blocks the upload just because compression didn't help.
 */
export async function compressImage(blob: Blob): Promise<Blob> {
  try {
    return await imageCompression(blob as File, {
      maxSizeMB: 0.4,
      maxWidthOrHeight: 1024,
      useWebWorker: true,
    });
  } catch (err) {
    console.error("[compressImage] falling back to the original blob:", err);
    return blob;
  }
}
