-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN     "readAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "chat_messages_receiverId_readAt_idx" ON "chat_messages"("receiverId", "readAt");

