-- AlterEnum
ALTER TYPE "ContributionStatus" ADD VALUE 'FAILED';

-- AlterEnum
ALTER TYPE "FineStatus" ADD VALUE 'FAILED';

-- AlterTable
-- updatedAt gets a DEFAULT so the ADD COLUMN ... NOT NULL backfills cleanly
-- against existing rows; Prisma's @updatedAt keeps maintaining it from here.
ALTER TABLE "contributions" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "payerPhone" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "fines" ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "payerPhone" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
