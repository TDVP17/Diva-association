-- AlterTable
ALTER TABLE "tontine_sessions" ADD COLUMN     "description" TEXT,
ADD COLUMN     "drawDate" TIMESTAMP(3),
ADD COLUMN     "fineAmountPerPeriod" DECIMAL(12,2),
ADD COLUMN     "fineIntervalHours" INTEGER,
ADD COLUMN     "isPaused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lockedAt" TIMESTAMP(3);

