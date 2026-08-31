-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "messageKey" TEXT,
ADD COLUMN     "messageVars" JSONB;
