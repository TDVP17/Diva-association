-- CreateEnum
CREATE TYPE "Role" AS ENUM ('MEMBER', 'ADMIN');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TontineType" AS ENUM ('HEBDO_SUNDAY', 'MONTHLY_25', 'MONTHLY_28');

-- CreateEnum
CREATE TYPE "TontineStatus" AS ENUM ('DRAFT', 'DRAWING', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "ContributionStatus" AS ENUM ('PAID', 'LATE', 'PENDING');

-- CreateEnum
CREATE TYPE "FineStatus" AS ENUM ('UNPAID', 'PAID', 'DEDUCTED');

-- CreateEnum
CREATE TYPE "SwapStatus" AS ENUM ('PENDING_MEMBERSHIP', 'PENDING_ADMIN', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatar" TEXT,
    "role" "Role" NOT NULL DEFAULT 'MEMBER',
    "kycStatus" "KycStatus" NOT NULL DEFAULT 'PENDING',
    "sponsorCode" TEXT,
    "city" TEXT,
    "neighborhood" TEXT,
    "cniUrl" TEXT,
    "selfieUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tontine_sessions" (
    "id" TEXT NOT NULL,
    "type" "TontineType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "fee" DECIMAL(12,2) NOT NULL,
    "status" "TontineStatus" NOT NULL DEFAULT 'DRAFT',
    "startDate" TIMESTAMP(3) NOT NULL,
    "limitTime" TEXT NOT NULL,

    CONSTRAINT "tontine_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tontineSessionId" TEXT NOT NULL,
    "officialPosition" INTEGER NOT NULL,
    "ballDrawn" INTEGER NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contributions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tontineSessionId" TEXT NOT NULL,
    "amountPaid" DECIMAL(12,2) NOT NULL,
    "feePaid" DECIMAL(12,2) NOT NULL,
    "finePaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "ContributionStatus" NOT NULL DEFAULT 'PENDING',
    "fapshiTxRef" TEXT,
    "paidAt" TIMESTAMP(3),
    "receiptPdfUrl" TEXT,

    CONSTRAINT "contributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fines" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tontineSessionId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "FineStatus" NOT NULL DEFAULT 'UNPAID',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "position_swap_requests" (
    "id" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "tontineSessionId" TEXT NOT NULL,
    "status" "SwapStatus" NOT NULL DEFAULT 'PENDING_MEMBERSHIP',

    CONSTRAINT "position_swap_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_userId_tontineSessionId_key" ON "memberships"("userId", "tontineSessionId");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tontineSessionId_fkey" FOREIGN KEY ("tontineSessionId") REFERENCES "tontine_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_tontineSessionId_fkey" FOREIGN KEY ("tontineSessionId") REFERENCES "tontine_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fines" ADD CONSTRAINT "fines_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fines" ADD CONSTRAINT "fines_tontineSessionId_fkey" FOREIGN KEY ("tontineSessionId") REFERENCES "tontine_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "position_swap_requests" ADD CONSTRAINT "position_swap_requests_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "position_swap_requests" ADD CONSTRAINT "position_swap_requests_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "position_swap_requests" ADD CONSTRAINT "position_swap_requests_tontineSessionId_fkey" FOREIGN KEY ("tontineSessionId") REFERENCES "tontine_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
