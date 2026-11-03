-- AlterTable
ALTER TABLE "contributions" ADD COLUMN IF NOT EXISTS "proofImageUrl" TEXT,
ADD COLUMN IF NOT EXISTS "proofUploadedAt" TIMESTAMP(3);
