-- Add Guarantor (Garant) acceptance workflow columns on kyc_verifications

ALTER TABLE "kyc_verifications" ADD COLUMN IF NOT EXISTS "referrerUserId" TEXT;
ALTER TABLE "kyc_verifications" ADD COLUMN IF NOT EXISTS "guarantorStatus" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "kyc_verifications" ADD COLUMN IF NOT EXISTS "guarantorAcceptedAt" TIMESTAMP(3);
ALTER TABLE "kyc_verifications" ADD COLUMN IF NOT EXISTS "guarantorDeclinedAt" TIMESTAMP(3);
ALTER TABLE "kyc_verifications" ADD COLUMN IF NOT EXISTS "guarantorDeclineReason" TEXT;

CREATE INDEX IF NOT EXISTS "kyc_verifications_referrerUserId_guarantorStatus_idx"
  ON "kyc_verifications"("referrerUserId", "guarantorStatus");

DO $$ BEGIN
  ALTER TABLE "kyc_verifications"
    ADD CONSTRAINT "kyc_verifications_referrerUserId_fkey"
    FOREIGN KEY ("referrerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
