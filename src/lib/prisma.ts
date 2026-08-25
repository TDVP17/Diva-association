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

function isTransientConnectionError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P1000";
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
      let lastErr: unknown;
      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
        try {
          return await query(args);
        } catch (err) {
          if (!isTransientConnectionError(err)) throw err;
          lastErr = err;
          if (attempt === RETRY_DELAYS_MS.length) break;
          console.warn(
            `[prisma] transient connection error on ${model}.${operation}, retrying (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length})`,
          );
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
        }
      }
      throw lastErr;
    },
  },
});
