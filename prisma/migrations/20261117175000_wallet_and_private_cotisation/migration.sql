-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "walletBalance" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "tontine_sessions" ADD COLUMN IF NOT EXISTS "isPrivate" BOOLEAN NOT NULL DEFAULT false;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "WalletTransactionType" AS ENUM ('DEPOSIT', 'CONTRIBUTION', 'FINE', 'PAYOUT', 'WITHDRAWAL', 'REFUND', 'ADMIN_ADJUST');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "wallet_transactions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "type" "WalletTransactionType" NOT NULL,
    "description" TEXT,
    "fapshiTxRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "wallet_transactions_userId_createdAt_idx" ON "wallet_transactions"("userId", "createdAt");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

