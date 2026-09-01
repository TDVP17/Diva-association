-- CreateEnum
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('PENDING', 'SUCCESSFUL', 'FAILED', 'EXPIRED', 'DUPLICATE_PAID', 'REFUND_INITIATED', 'REFUNDED', 'REFUND_FAILED_MANUAL_REVIEW');

-- AlterEnum
-- PAYMENT_FAILED was added to schema.prisma in an earlier change but never
-- actually landed in the live enum (no prior migration contained it) —
-- picked up here so notification writes using it stop failing.
ALTER TYPE "NotificationEventType" ADD VALUE 'PAYMENT_FAILED';
ALTER TYPE "NotificationEventType" ADD VALUE 'PAYMENT_REFUND_ESCALATED';

-- AlterTable
-- Drops the migration-only backfill default now that every existing row has
-- a value — matches schema.prisma, which only declares @updatedAt (no
-- @default), and keeps future `prisma migrate diff` runs clean.
ALTER TABLE "contributions" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "fines" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "payment_attempts" (
    "id" TEXT NOT NULL,
    "transId" TEXT NOT NULL,
    "contributionId" TEXT,
    "fineId" TEXT,
    "payerPhone" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'PENDING',
    "refundReason" TEXT,
    "refundTransId" TEXT,
    "refundedAt" TIMESTAMP(3),
    "refundAttempts" INTEGER NOT NULL DEFAULT 0,
    "nextRefundAttemptAt" TIMESTAMP(3),
    "lastRefundError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_transId_key" ON "payment_attempts"("transId");

-- CreateIndex
CREATE INDEX "payment_attempts_contributionId_idx" ON "payment_attempts"("contributionId");

-- CreateIndex
CREATE INDEX "payment_attempts_fineId_idx" ON "payment_attempts"("fineId");

-- CreateIndex
CREATE INDEX "payment_attempts_status_nextRefundAttemptAt_idx" ON "payment_attempts"("status", "nextRefundAttemptAt");

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_contributionId_fkey" FOREIGN KEY ("contributionId") REFERENCES "contributions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_fineId_fkey" FOREIGN KEY ("fineId") REFERENCES "fines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
