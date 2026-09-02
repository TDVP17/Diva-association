import { describe, it, expect, vi } from "vitest";

const imageCompression = vi.fn();
vi.mock("browser-image-compression", () => ({ default: (...a: unknown[]) => imageCompression(...a) }));

import { compressImage, ImageTooLargeError, MAX_OUTPUT_BYTES } from "@/lib/compress-image";

describe("compressImage", () => {
  it("returns the compressed blob on success", async () => {
    const original = new Blob(["original"]);
    const compressed = new Blob(["compressed"]);
    imageCompression.mockResolvedValue(compressed);

    const result = await compressImage(original);
    expect(result).toBe(compressed);
  });

  it("falls back to the original blob if compression throws, when the original is small enough", async () => {
    const original = new Blob(["original"]);
    imageCompression.mockRejectedValue(new Error("worker failed"));

    const result = await compressImage(original);
    expect(result).toBe(original);
  });

  it("throws ImageTooLargeError instead of silently uploading a huge fallback when compression fails on a large original", async () => {
    const hugeOriginal = new Blob([new Uint8Array(MAX_OUTPUT_BYTES + 1)]);
    imageCompression.mockRejectedValue(new Error("unsupported format (HEIC)"));

    await expect(compressImage(hugeOriginal)).rejects.toBeInstanceOf(ImageTooLargeError);
  });

  it("throws ImageTooLargeError when compression succeeds but still can't get under the limit", async () => {
    const original = new Blob(["original"]);
    const stillTooBig = new Blob([new Uint8Array(MAX_OUTPUT_BYTES + 1)]);
    imageCompression.mockResolvedValue(stillTooBig);

    await expect(compressImage(original)).rejects.toBeInstanceOf(ImageTooLargeError);
  });
});
