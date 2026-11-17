-- Add PENDING_ADMIN and REJECTED to LoanStatus + Admin approval columns on loans

DO $$ BEGIN
  ALTER TYPE "LoanStatus" ADD VALUE IF NOT EXISTS 'PENDING_ADMIN';
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TYPE "LoanStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "loans" ADD COLUMN IF NOT EXISTS "requiresAdminApproval" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "loans" ADD COLUMN IF NOT EXISTS "approvedByAdminId" TEXT;
ALTER TABLE "loans" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE "loans" ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT;

DO $$ BEGIN
  ALTER TABLE "loans"
    ADD CONSTRAINT "loans_approvedByAdminId_fkey"
    FOREIGN KEY ("approvedByAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
