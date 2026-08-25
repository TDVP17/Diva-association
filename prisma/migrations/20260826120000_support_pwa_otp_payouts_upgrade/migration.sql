-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('EMAIL_CHANGE', 'PHONE_CHANGE', 'PASSWORD_CHANGE');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "lastAdminAutoReplyAt" TIMESTAMP(3),
ADD COLUMN     "payoutPhone" TEXT,
ADD COLUMN     "preferredLang" TEXT;

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "pendingValue" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" TEXT NOT NULL,
    "tontineSessionId" TEXT NOT NULL,
    "membershipSlotId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "pot" DECIMAL(12,2) NOT NULL,
    "deducted" DECIMAL(12,2) NOT NULL,
    "netPayout" DECIMAL(12,2) NOT NULL,
    "fapshiTransId" TEXT,
    "releasedByAdminId" TEXT NOT NULL,
    "releasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "otp_challenges_userId_purpose_idx" ON "otp_challenges"("userId", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_fapshiTransId_key" ON "payouts"("fapshiTransId");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_tontineSessionId_dueDate_key" ON "payouts"("tontineSessionId", "dueDate");

-- AddForeignKey
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_tontineSessionId_fkey" FOREIGN KEY ("tontineSessionId") REFERENCES "tontine_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_membershipSlotId_fkey" FOREIGN KEY ("membershipSlotId") REFERENCES "membership_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_releasedByAdminId_fkey" FOREIGN KEY ("releasedByAdminId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

