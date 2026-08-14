-- AlterTable
ALTER TABLE "contributions" ADD COLUMN     "dueDate" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "fines" ADD COLUMN     "dueDate" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "contributions_fapshiTxRef_key" ON "contributions"("fapshiTxRef");

-- CreateIndex
CREATE UNIQUE INDEX "contributions_userId_tontineSessionId_dueDate_key" ON "contributions"("userId", "tontineSessionId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "fines_userId_tontineSessionId_dueDate_key" ON "fines"("userId", "tontineSessionId", "dueDate");
