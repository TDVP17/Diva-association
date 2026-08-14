-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('REMINDER_NOON', 'REMINDER_URGENT', 'PAYMENT_SUCCESS', 'FINE_NOTICE');

-- AlterTable
ALTER TABLE "memberships" ALTER COLUMN "officialPosition" DROP NOT NULL,
ALTER COLUMN "ballDrawn" DROP NOT NULL;

-- AlterTable
ALTER TABLE "position_swap_requests" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "phone" TEXT;

-- CreateTable
CREATE TABLE "notification_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tontineSessionId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "type" "NotificationType" NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_logs_userId_tontineSessionId_dueDate_type_key" ON "notification_logs"("userId", "tontineSessionId", "dueDate", "type");

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_tontineSessionId_fkey" FOREIGN KEY ("tontineSessionId") REFERENCES "tontine_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
