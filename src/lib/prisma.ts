import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// DATABASE_URL goes through Supabase's PgBouncer transaction-mode pooler.
// In testing, connections it hands out sometimes fail on first use with a
// misleading "Authentication failed" (P1000) error instead of a clean
// "connection closed" — reproducible even seconds after a prior query on
// the same pool succeeded, so this isn't purely an idle-timeout question we
// can tune our way out of; Supabase's side of the pooler isn't fully
// predictable from here. Kept the pool small/short-lived (below) as a
// first line of defense, but the actual fix is retrying once — see
// withTransientRetry.
const adapter = new PrismaPg(
  {
    connectionString: process.env.DATABASE_URL,
    max: 3,
    idleTimeoutMillis: 3_000,
    connectionTimeoutMillis: 10_000,
  },
  {
    onPoolError: (err) => console.error("[prisma] pg pool error:", err.message),
    onConnectionError: (err) => console.error("[prisma] pg connection error:", err.message),
  },
);

const rawPrisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = rawPrisma;
}

// P1000 ("Authentication failed") is the one this was originally written
// for, but the same underlying pooler flakiness surfaces under several
// other codes too — P1001/P1002 (can't reach / timed out), P1008
// (operation timed out), P1017 (server closed the connection), and raw
// driver-level codes (@prisma/adapter-pg passes node-postgres/network
// errors through more directly than the old query-engine binary did) like
// ECONNREFUSED, ECONNRESET, ETIMEDOUT, EPIPE. Restricting the match to only
// P1000 meant a real transient failure under any of these other codes
// propagated straight through as an unhandled 500 instead of being retried.
const TRANSIENT_PRISMA_CODES = new Set(["P1000", "P1001", "P1002", "P1008", "P1017"]);
const TRANSIENT_DRIVER_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE"]);

function isTransientConnectionError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError && TRANSIENT_PRISMA_CODES.has(err.code)) return true;
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && TRANSIENT_DRIVER_CODES.has(code);
}

// Every query gets automatic retries on the specific "pooled connection
// turned out to be dead" error class described above, before giving up and
// letting the error propagate normally. A single retry was enough during
// initial testing, but this flakiness comes in bursts of varying severity —
// during a bad burst even 2-3 consecutive attempts can fail, so this backs
// off across a few attempts rather than giving up after one.
const RETRY_DELAYS_MS = [200, 500, 1000];

export const prisma = rawPrisma.$extends({
  query: {
    async $allOperations({ model, operation, args, query }) {
      return withTransientRetry(() => query(args), `${model}.${operation}`);
    },
  },
});

/**
 * Retries a full async operation from scratch on the same transient-
 * connection error class $allOperations handles for single queries above —
 * needed separately because that per-query wrapping can't help
 * prisma.$transaction(): an interactive transaction holds one connection
 * for its whole callback, so if THAT connection is one of the pool's
 * sometimes-dead-on-first-use ones, retrying a query inside the callback
 * just retries against the same broken connection. Wrap the *entire*
 * $transaction(...) call in this instead — a fresh attempt acquires a new
 * connection from the pool, same as a retried standalone query does.
 */
export async function withTransientRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isTransientConnectionError(err)) throw err;
      lastErr = err;
      if (attempt === RETRY_DELAYS_MS.length) break;
      console.warn(
        `[prisma] transient connection error on ${label}, retrying (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length})`,
      );
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }
  throw lastErr;
}
