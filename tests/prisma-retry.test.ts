import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { withTransientRetry } from "@/lib/prisma";

function knownRequestError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("boom", { code, clientVersion: "7.9.1" });
}

function driverError(code: string): Error {
  return Object.assign(new Error("boom"), { code });
}

describe("withTransientRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the result immediately on success — no retry overhead for the common case", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withTransientRetry(fn, "test-op");
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry a non-transient error — it propagates on the first attempt", async () => {
    const fn = vi.fn().mockRejectedValue(knownRequestError("P2002"));
    await expect(withTransientRetry(fn, "test-op")).rejects.toMatchObject({ code: "P2002" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a transient Prisma error code (P1001) and succeeds once the connection recovers", async () => {
    const fn = vi.fn().mockRejectedValueOnce(knownRequestError("P1001")).mockResolvedValueOnce("ok");
    const promise = withTransientRetry(fn, "test-op");
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries a raw driver-level error code (ECONNREFUSED) — the exact class the P1000-only check used to miss", async () => {
    const fn = vi.fn().mockRejectedValueOnce(driverError("ECONNREFUSED")).mockResolvedValueOnce("ok");
    const promise = withTransientRetry(fn, "test-op");
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("gives up and throws the last error after exhausting all retries", async () => {
    const fn = vi.fn().mockRejectedValue(driverError("ECONNRESET"));
    const promise = withTransientRetry(fn, "test-op");
    const assertion = expect(promise).rejects.toMatchObject({ code: "ECONNRESET" });
    await vi.runAllTimersAsync();
    await assertion;
    // 1 initial attempt + 3 retries (RETRY_DELAYS_MS has 3 entries in src/lib/prisma.ts)
    expect(fn).toHaveBeenCalledTimes(4);
  });
});
