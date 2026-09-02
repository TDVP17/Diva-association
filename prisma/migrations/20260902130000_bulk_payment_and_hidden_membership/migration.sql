-- AlterTable
ALTER TABLE "contributions" ADD COLUMN     "bulkPaymentId" TEXT;

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "hiddenByMemberAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "payment_attempts" ADD COLUMN     "bulkPaymentId" TEXT;

-- CreateTable
CREATE TABLE "bulk_payments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "transId" TEXT,
    "payerPhone" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bulk_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bulk_payments_transId_key" ON "bulk_payments"("transId");

-- CreateIndex
CREATE INDEX "bulk_payments_userId_createdAt_idx" ON "bulk_payments"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "contributions_bulkPaymentId_idx" ON "contributions"("bulkPaymentId");

-- CreateIndex
CREATE INDEX "payment_attempts_bulkPaymentId_idx" ON "payment_attempts"("bulkPaymentId");

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_bulkPaymentId_fkey" FOREIGN KEY ("bulkPaymentId") REFERENCES "bulk_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_payments" ADD CONSTRAINT "bulk_payments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_bulkPaymentId_fkey" FOREIGN KEY ("bulkPaymentId") REFERENCES "bulk_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
