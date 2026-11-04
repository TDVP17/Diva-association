-- AlterTable: add proofImageUrls array column for multiple payment proof screenshots
ALTER TABLE "contributions"
  ADD COLUMN IF NOT EXISTS "proofImageUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Backfill proofImageUrls from existing proofImageUrl and fix stuck FAILED status on pending proofs
UPDATE "contributions"
SET "proofImageUrls" = ARRAY["proofImageUrl"]
WHERE "proofImageUrl" IS NOT NULL
  AND cardinality("proofImageUrls") = 0;

UPDATE "contributions"
SET "status" = 'PENDING'
WHERE "proofImageUrl" IS NOT NULL
  AND "status" = 'FAILED'
  AND "failureReason" IS NULL;

-- CreateTable: singleton admin configuration for fallback merchant USSD codes & beneficiary names
CREATE TABLE IF NOT EXISTS "fallback_payment_configs" (
  "id" TEXT NOT NULL DEFAULT 'singleton',
  "orangeUssdCode" TEXT NOT NULL DEFAULT '',
  "orangeBeneficiaryName" TEXT NOT NULL DEFAULT '',
  "mtnUssdCode" TEXT NOT NULL DEFAULT '',
  "mtnBeneficiaryName" TEXT NOT NULL DEFAULT '',
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedByAdminId" TEXT,

  CONSTRAINT "fallback_payment_configs_pkey" PRIMARY KEY ("id")
);

