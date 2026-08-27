-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationEventType" ADD VALUE 'SWAP_REQUEST_CREATED';
ALTER TYPE "NotificationEventType" ADD VALUE 'SWAP_REQUEST_PENDING_ADMIN';
ALTER TYPE "NotificationEventType" ADD VALUE 'SWAP_REQUEST_APPROVED';
ALTER TYPE "NotificationEventType" ADD VALUE 'SWAP_REQUEST_REJECTED';
ALTER TYPE "NotificationEventType" ADD VALUE 'NEW_MEMBERSHIP_REQUEST';
ALTER TYPE "NotificationEventType" ADD VALUE 'DRAW_LAUNCHED';

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "actionUrl" TEXT;

-- CreateTable
CREATE TABLE "transaction_archives" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "pdfUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_archives_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transaction_archives_userId_periodStart_key" ON "transaction_archives"("userId", "periodStart");

-- AddForeignKey
ALTER TABLE "transaction_archives" ADD CONSTRAINT "transaction_archives_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

