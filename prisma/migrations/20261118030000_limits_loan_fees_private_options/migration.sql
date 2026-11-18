-- Global & Per-User Withdrawal Limits, Loan DIVA Fee & Day-20 Reminder, Private Cotisation Options
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "maxWithdrawalAmount" DECIMAL(12,2);

ALTER TABLE "tontine_sessions"
  ADD COLUMN IF NOT EXISTS "privateConfig" JSONB;

ALTER TABLE "app_settings"
  ADD COLUMN IF NOT EXISTS "min_withdrawal_amount" DECIMAL(12,2) NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS "max_withdrawal_amount" DECIMAL(12,2) NOT NULL DEFAULT 500000;

ALTER TABLE "loans"
  ADD COLUMN IF NOT EXISTS "divaFeeAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "day20ReminderSentAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "repayFapshiTransId" TEXT;

