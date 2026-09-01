-- CreateEnum
CREATE TYPE "AuditLogStatus" AS ENUM ('SUCCESS', 'FAILED', 'BLOCKED');

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "actorRole" "Role",
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "ipAddress" TEXT,
ADD COLUMN     "payloadAfter" JSONB,
ADD COLUMN     "payloadBefore" JSONB,
ADD COLUMN     "status" "AuditLogStatus" NOT NULL DEFAULT 'SUCCESS',
ADD COLUMN     "userAgent" TEXT;

-- AlterTable
ALTER TABLE "payment_attempts" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_status_createdAt_idx" ON "audit_logs"("status", "createdAt");

-- Immutability enforcement: audit_logs may only ever be inserted into. This
-- rejects UPDATE/DELETE unconditionally at the database level, regardless
-- of which role or connection (Prisma service connection, Supabase Studio,
-- a future admin tool) issues the statement — stronger than an
-- application-layer check, which could always be bypassed by code that
-- forgets to call it.
CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs rows are immutable — % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

CREATE TRIGGER audit_logs_no_delete
  BEFORE DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
