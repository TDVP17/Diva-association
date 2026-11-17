-- Migration idempotente pour l'implémentation complète du Cahier des Charges DIVA Asso
-- Piliers 1 (Portefeuille), 2 (Prêts Garantis), 3 (Cotisations Privées), 4 (Sécurité Retraits)

-- 1. Enums additions
DO $$ BEGIN
  ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'WITHDRAWAL_PENDING_ADMIN';
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'WITHDRAWAL_APPROVED';
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'WITHDRAWAL_REJECTED';
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'LOAN_DISBURSED';
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'LOAN_OVERDUE';
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'LOAN_REPAID';
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'LOAN_DEDUCTED';
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TYPE "WalletTransactionType" ADD VALUE IF NOT EXISTS 'LOAN_DISBURSEMENT';
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TYPE "WalletTransactionType" ADD VALUE IF NOT EXISTS 'LOAN_REPAYMENT';
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "WithdrawalStatus" AS ENUM ('PENDING_ADMIN', 'APPROVED', 'AUTO_PROCESSED', 'COMPLETED', 'REJECTED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "LoanStatus" AS ENUM ('ACTIVE', 'OVERDUE', 'REPAID', 'DEDUCTED_FROM_POT');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2. Alter users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "walletPinHash" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "walletPinSetAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phoneChangedAt" TIMESTAMP(3);

-- 3. Alter saved_payment_methods (ensure disbursement fields exist)
ALTER TABLE "saved_payment_methods" ADD COLUMN IF NOT EXISTS "accountName" TEXT;
ALTER TABLE "saved_payment_methods" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "saved_payment_methods" ADD COLUMN IF NOT EXISTS "verifiedAt" TIMESTAMP(3);
ALTER TABLE "saved_payment_methods" ADD COLUMN IF NOT EXISTS "verifiedByAdminId" TEXT;
ALTER TABLE "saved_payment_methods" ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT;

-- 4. Alter tontine_sessions (Cotisations Privées sur Invitation)
ALTER TABLE "tontine_sessions" ADD COLUMN IF NOT EXISTS "inviteToken" TEXT;
ALTER TABLE "tontine_sessions" ADD COLUMN IF NOT EXISTS "creatorId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "tontine_sessions_inviteToken_key" ON "tontine_sessions"("inviteToken");

DO $$ BEGIN
  ALTER TABLE "tontine_sessions"
    ADD CONSTRAINT "tontine_sessions_creatorId_fkey"
    FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 5. Alter wallet_transactions (Audit trail immuable balanceBefore/balanceAfter)
ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "balanceBefore" DECIMAL(12,2);
ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "balanceAfter" DECIMAL(12,2);
ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "reference" TEXT;
ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'COMPLETED';
ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "metadata" JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS "wallet_transactions_reference_key" ON "wallet_transactions"("reference");

-- 6. Create wallet_withdrawals
CREATE TABLE IF NOT EXISTS "wallet_withdrawals" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "phone" TEXT NOT NULL,
    "provider" "MobileMoneyProvider" NOT NULL,
    "accountName" TEXT NOT NULL,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'PENDING_ADMIN',
    "requiresAdminApproval" BOOLEAN NOT NULL DEFAULT false,
    "fapshiTransId" TEXT,
    "approvedByAdminId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_withdrawals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wallet_withdrawals_fapshiTransId_key" ON "wallet_withdrawals"("fapshiTransId");
CREATE INDEX IF NOT EXISTS "wallet_withdrawals_userId_createdAt_idx" ON "wallet_withdrawals"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "wallet_withdrawals_status_createdAt_idx" ON "wallet_withdrawals"("status", "createdAt");

DO $$ BEGIN
  ALTER TABLE "wallet_withdrawals"
    ADD CONSTRAINT "wallet_withdrawals_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "wallet_withdrawals"
    ADD CONSTRAINT "wallet_withdrawals_approvedByAdminId_fkey"
    FOREIGN KEY ("approvedByAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 7. Create loans
CREATE TABLE IF NOT EXISTS "loans" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "principal" DECIMAL(12,2) NOT NULL,
    "interestRate" DECIMAL(5,4) NOT NULL DEFAULT 0.15,
    "interestAmount" DECIMAL(12,2) NOT NULL,
    "penaltyAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalDue" DECIMAL(12,2) NOT NULL,
    "totalPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "LoanStatus" NOT NULL DEFAULT 'ACTIVE',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "graceEndDate" TIMESTAMP(3) NOT NULL,
    "lastPenaltyAt" TIMESTAMP(3),
    "guaranteeSlotId" TEXT,
    "collateralSnapshot" JSONB,
    "repaidAt" TIMESTAMP(3),
    "deductedFromPayoutId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loans_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "loans_userId_status_idx" ON "loans"("userId", "status");
CREATE INDEX IF NOT EXISTS "loans_status_dueDate_idx" ON "loans"("status", "dueDate");

DO $$ BEGIN
  ALTER TABLE "loans"
    ADD CONSTRAINT "loans_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "loans"
    ADD CONSTRAINT "loans_guaranteeSlotId_fkey"
    FOREIGN KEY ("guaranteeSlotId") REFERENCES "membership_slots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

