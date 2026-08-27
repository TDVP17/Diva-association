import { describe, it, expect, vi } from "vitest";

const imageCompression = vi.fn();
vi.mock("browser-image-compression", () => ({ default: (...a: unknown[]) => imageCompression(...a) }));

import { compressImage } from "@/lib/compress-image";

describe("compressImage", () => {
  it("returns the compressed blob on success", async () => {
    const original = new Blob(["original"]);
    const compressed = new Blob(["compressed"]);
    imageCompression.mockResolvedValue(compressed);

    const result = await compressImage(original);
    expect(result).toBe(compressed);
  });

  it("falls back to the original blob if compression throws", async () => {
    const original = new Blob(["original"]);
    imageCompression.mockRejectedValue(new Error("worker failed"));

    const result = await compressImage(original);
    expect(result).toBe(original);
  });
});
