-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'REMINDER_EVE';

-- AlterTable
ALTER TABLE "memberships" DROP CONSTRAINT IF EXISTS "memberships_slotCount_range";

-- Enforce the 1-15 range at the database level.
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_slotCount_range" CHECK ("slotCount" IS NULL OR ("slotCount" >= 1 AND "slotCount" <= 15));
