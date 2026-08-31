-- AlterEnum
ALTER TYPE "TontineType" ADD VALUE 'EVERY_MONDAY';
ALTER TYPE "TontineType" ADD VALUE 'EVERY_TUESDAY';
ALTER TYPE "TontineType" ADD VALUE 'EVERY_WEDNESDAY';
ALTER TYPE "TontineType" ADD VALUE 'EVERY_THURSDAY';
ALTER TYPE "TontineType" ADD VALUE 'EVERY_FRIDAY';
ALTER TYPE "TontineType" ADD VALUE 'EVERY_SATURDAY';
ALTER TYPE "TontineType" ADD VALUE 'MONTHLY_1';
ALTER TYPE "TontineType" ADD VALUE 'MONTHLY_5';
ALTER TYPE "TontineType" ADD VALUE 'MONTHLY_10';
ALTER TYPE "TontineType" ADD VALUE 'MONTHLY_15';
ALTER TYPE "TontineType" ADD VALUE 'MONTHLY_20';
ALTER TYPE "TontineType" ADD VALUE 'BIWEEKLY_MONDAY';
ALTER TYPE "TontineType" ADD VALUE 'BIWEEKLY_TUESDAY';
ALTER TYPE "TontineType" ADD VALUE 'BIWEEKLY_WEDNESDAY';
ALTER TYPE "TontineType" ADD VALUE 'BIWEEKLY_THURSDAY';
ALTER TYPE "TontineType" ADD VALUE 'BIWEEKLY_FRIDAY';
ALTER TYPE "TontineType" ADD VALUE 'BIWEEKLY_SATURDAY';

-- Normalize the one existing fractional slotCount (1.5 -> 1, matching the
-- single MembershipSlot row that was ever actually created for it under
-- the old Math.floor(slotCount) rule) before changing the column type.
UPDATE "memberships" SET "slotCount" = FLOOR("slotCount") WHERE "slotCount" IS NOT NULL;

-- AlterTable
ALTER TABLE "memberships" ALTER COLUMN "slotCount" SET DATA TYPE INTEGER;

-- Enforce the 1-5 range at the database level, not just in the API layer.
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_slotCount_range" CHECK ("slotCount" IS NULL OR ("slotCount" >= 1 AND "slotCount" <= 5));
