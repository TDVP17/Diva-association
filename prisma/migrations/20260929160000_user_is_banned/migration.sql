-- AlterTable
ALTER TABLE "users" ADD COLUMN "isBanned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "bannedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "bannedReason" TEXT;

-- Retroactively mark any users whose membership was banned as banned users
UPDATE "users"
SET "isBanned" = true, "bannedAt" = NOW()
WHERE id IN (
    SELECT DISTINCT "userId" FROM "memberships" WHERE status = 'BANNED'
);
