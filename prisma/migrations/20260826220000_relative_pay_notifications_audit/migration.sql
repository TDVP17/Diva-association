-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'WHATSAPP', 'IN_APP');

-- CreateEnum
CREATE TYPE "NotificationEventType" AS ENUM ('CONTRIBUTION_REMINDER', 'FINE_REMINDER', 'FOOD_TURN', 'PAYMENT_SUCCESS', 'ADMIN_BROADCAST');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SCHEDULED', 'PROCESSING', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "contributions" ADD COLUMN     "paidByUserId" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "memberCode" TEXT;

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "tontineSessionId" TEXT,
    "userId" TEXT NOT NULL,
    "membershipSlotId" TEXT,
    "channel" "NotificationChannel" NOT NULL,
    "type" "NotificationEventType" NOT NULL,
    "message" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_turn_logs" (
    "id" TEXT NOT NULL,
    "membershipSlotId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "food_turn_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "tontineSessionId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");

-- CreateIndex
CREATE INDEX "notifications_tontineSessionId_status_idx" ON "notifications"("tontineSessionId", "status");

-- CreateIndex
CREATE INDEX "notifications_status_scheduledAt_idx" ON "notifications"("status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "food_turn_logs_membershipSlotId_dueDate_key" ON "food_turn_logs"("membershipSlotId", "dueDate");

-- CreateIndex
CREATE INDEX "audit_logs_tontineSessionId_createdAt_idx" ON "audit_logs"("tontineSessionId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_createdAt_idx" ON "audit_logs"("actorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "users_memberCode_key" ON "users"("memberCode");

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_paidByUserId_fkey" FOREIGN KEY ("paidByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tontineSessionId_fkey" FOREIGN KEY ("tontineSessionId") REFERENCES "tontine_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_turn_logs" ADD CONSTRAINT "food_turn_logs_membershipSlotId_fkey" FOREIGN KEY ("membershipSlotId") REFERENCES "membership_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tontineSessionId_fkey" FOREIGN KEY ("tontineSessionId") REFERENCES "tontine_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

