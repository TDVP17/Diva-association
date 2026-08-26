-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'PRESIDENT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TontineType" ADD VALUE 'BIWEEKLY_SUNDAY';
ALTER TYPE "TontineType" ADD VALUE 'QUARTERLY_25';

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "rejectionReason" TEXT;

