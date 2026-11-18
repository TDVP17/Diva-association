-- Complete Private Cotisation System, Emergency Fund (Secours), PIN Brute-Force Lockout, Loan Consent, Withdrawal Reversal & Fine Distribution Idempotency

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "walletPinFailedAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "walletPinLockedUntil" TIMESTAMP(3);

ALTER TABLE "tontine_sessions"
  ADD COLUMN IF NOT EXISTS "creatorParticipates" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "privateMinParticipants" INTEGER,
  ADD COLUMN IF NOT EXISTS "privateAdditionalFeePayoutPct" INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS "privatePenaltyBeneficiaryPct" INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS "privateFinancialRulesLockedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "parentSessionId" TEXT,
  ADD COLUMN IF NOT EXISTS "softDeletedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "softDeletedByAdminId" TEXT;

ALTER TABLE "memberships"
  ADD COLUMN IF NOT EXISTS "disclaimerAcceptedAt" TIMESTAMP(3);

ALTER TABLE "loans"
  ADD COLUMN IF NOT EXISTS "termsAcceptedAt" TIMESTAMP(3);

ALTER TABLE "wallet_withdrawals"
  ADD COLUMN IF NOT EXISTS "reversedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reversedByAdminId" TEXT,
  ADD COLUMN IF NOT EXISTS "reversalReason" TEXT;

ALTER TABLE "fines"
  ADD COLUMN IF NOT EXISTS "penaltyDistributedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "private_emergency_funds" (
  "id" TEXT NOT NULL,
  "tontineSessionId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "minimumAmount" DECIMAL(12,2) NOT NULL,
  "frequency" TEXT,
  "rules" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "private_emergency_funds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "private_emergency_funds_tontineSessionId_key" UNIQUE ("tontineSessionId"),
  CONSTRAINT "private_emergency_funds_tontineSessionId_fkey" FOREIGN KEY ("tontineSessionId") REFERENCES "tontine_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "private_emergency_fund_contributions" (
  "id" TEXT NOT NULL,
  "fundId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "paymentMethod" TEXT NOT NULL DEFAULT 'WALLET',
  "walletTxRef" TEXT,
  "fapshiTxRef" TEXT,
  "status" TEXT NOT NULL DEFAULT 'COMPLETED',
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "private_emergency_fund_contributions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "private_emergency_fund_contributions_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "private_emergency_funds"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "private_emergency_fund_contributions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "private_emergency_fund_contributions_fundId_createdAt_idx" ON "private_emergency_fund_contributions"("fundId", "createdAt");
CREATE INDEX IF NOT EXISTS "private_emergency_fund_contributions_userId_createdAt_idx" ON "private_emergency_fund_contributions"("userId", "createdAt");

