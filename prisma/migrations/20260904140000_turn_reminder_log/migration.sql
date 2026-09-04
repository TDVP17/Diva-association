-- AlterEnum
ALTER TYPE "NotificationEventType" ADD VALUE 'TURN_REMINDER_TOMORROW';

-- CreateTable
CREATE TABLE "turn_reminder_logs" (
    "id" TEXT NOT NULL,
    "membershipSlotId" TEXT NOT NULL,
    "estimatedDate" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "turn_reminder_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "turn_reminder_logs_membershipSlotId_estimatedDate_key" ON "turn_reminder_logs"("membershipSlotId", "estimatedDate");

-- AddForeignKey
ALTER TABLE "turn_reminder_logs" ADD CONSTRAINT "turn_reminder_logs_membershipSlotId_fkey" FOREIGN KEY ("membershipSlotId") REFERENCES "membership_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
