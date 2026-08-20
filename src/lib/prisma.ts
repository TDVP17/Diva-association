import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Modest pool size + a short idle timeout: DATABASE_URL goes through
// Supabase's PgBouncer transaction-mode pooler, which has its own (limited,
// especially on free-tier projects) upstream connection budget and can drop
// idle backend connections out from under a long-lived app-side pool. Left
// at node-postgres's defaults (max: 10, no idle timeout), a connection that
// went stale surfaced as a misleading "Authentication failed" error on next
// use instead of being cleanly recycled.
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
});

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
