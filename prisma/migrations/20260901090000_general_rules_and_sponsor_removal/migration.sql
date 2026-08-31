-- AlterTable
ALTER TABLE "tontine_sessions" DROP COLUMN "rules";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "sponsorCode";

-- CreateTable
CREATE TABLE "association_rules" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "content" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByAdminId" TEXT,

    CONSTRAINT "association_rules_pkey" PRIMARY KEY ("id")
);
